"""
Admin panel API: login/logout, runtime settings, audit trail and password
change.

Sessions are server-side: the browser holds a random token in an HttpOnly,
SameSite=Strict cookie scoped to this router's path, and the database holds
only its SHA-256. State-changing requests must also carry a custom header,
which a cross-site form cannot send.
"""
import asyncio
import hmac
import logging
from datetime import datetime, timedelta, timezone
from typing import Optional
from uuid import UUID

from access import ADMIN_COOKIE, client_key, cookie_values, is_https
from access import COOKIE_PATH as ACCESS_COOKIE_PATH
from admin_auth import (
    DUMMY_PASSWORD_HASH,
    MAX_PASSWORD_LENGTH,
    LoginRateLimiter,
    hash_password,
    hash_session_token,
    new_session_token,
    password_problem,
    verify_password,
)
from config import Settings, get_settings
from dependencies import get_admin_repository, get_token_repository, get_user_repository
from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from llm_prompts import QWEN3_NO_THINK, TRANSLATION_OUTPUT_CONTRACT
from pydantic import BaseModel, Field, field_validator
from repositories.admin_repository import AdminRepository
from repositories.token_repository import NegativeBalanceError, TokenRepository
from repositories.user_repository import UsernameTakenError, UserRepository
from runtime_settings import WHISPER_LANGUAGE_CODES, RuntimeSettings
from services.runtime_settings_service import RuntimeSettingsService
from services.user_service import UserService

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/admin")

SESSION_COOKIE = ADMIN_COOKIE
# The whole API, so the administrator can open users' audios and projects in
# the app. Sessions from before lived at /api/v1/admin; that copy is removed
# at login and logout.
COOKIE_PATH = ACCESS_COOKIE_PATH
LEGACY_COOKIE_PATH = "/api/v1/admin"
CSRF_HEADER = "x-meetmemo-admin"

_rate_limiter = LoginRateLimiter()


class LoginRequest(BaseModel):
    """Admin login credentials."""
    username: str = Field(min_length=1, max_length=200)
    password: str = Field(min_length=1, max_length=MAX_PASSWORD_LENGTH)


class PasswordChangeRequest(BaseModel):
    """Admin password change."""
    current_password: str = Field(min_length=1, max_length=MAX_PASSWORD_LENGTH)
    new_password: str = Field(min_length=1, max_length=MAX_PASSWORD_LENGTH)


def _client_key(request: Request) -> str:
    return client_key(request)


def _is_https(request: Request) -> bool:
    return is_https(request)


async def _verify_password(password: str, stored_hash: str) -> bool:
    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(None, verify_password, password, stored_hash)


def require_admin_header(request: Request) -> None:
    """Reject state-changing requests that lack the custom admin header."""
    if request.headers.get(CSRF_HEADER) != "1":
        raise HTTPException(status_code=403, detail="Missing admin request header")


async def require_admin(
    request: Request, repo: AdminRepository = Depends(get_admin_repository)
) -> dict:
    """Resolve the logged-in admin from the session cookie, or 401."""
    for token in cookie_values(request, SESSION_COOKIE):
        token_hash = hash_session_token(token)
        session = await repo.get_session(token_hash)
        if session:
            return {"username": session["username"], "token_hash": token_hash}
    raise HTTPException(status_code=401, detail="Not authenticated")


@router.get("/status")
async def admin_status(repo: AdminRepository = Depends(get_admin_repository)) -> dict:
    """Whether an admin account exists (public)."""
    return {"configured": await repo.get_credentials() is not None}


@router.post("/login", dependencies=[Depends(require_admin_header)])
async def login(
    body: LoginRequest,
    request: Request,
    response: Response,
    repo: AdminRepository = Depends(get_admin_repository),
    settings: Settings = Depends(get_settings),
) -> dict:
    """Start an admin session."""
    client = _client_key(request)
    if _rate_limiter.is_blocked(client):
        raise HTTPException(
            status_code=429, detail="Too many failed attempts. Try again later."
        )

    credentials = await repo.get_credentials()
    if credentials is None:
        raise HTTPException(
            status_code=503,
            detail="Admin account not configured. Set ADMIN_PASSWORD and restart the backend.",
        )

    username_ok = hmac.compare_digest(
        body.username.encode("utf-8"), credentials["username"].encode("utf-8")
    )
    # Always run the (slow) hash check so timing doesn't reveal the username.
    stored_hash = credentials["password_hash"] if username_ok else DUMMY_PASSWORD_HASH
    password_ok = await _verify_password(body.password, stored_hash)
    if not (username_ok and password_ok):
        _rate_limiter.record_failure(client)
        logger.warning("Failed admin login from %s", client)
        raise HTTPException(status_code=401, detail="Invalid username or password.")

    _rate_limiter.reset(client)
    token = new_session_token()
    max_age = settings.admin_session_hours * 3600
    await repo.create_session(
        hash_session_token(token),
        credentials["username"],
        datetime.now(timezone.utc) + timedelta(seconds=max_age),
    )
    response.delete_cookie(SESSION_COOKIE, path=LEGACY_COOKIE_PATH)
    response.set_cookie(
        SESSION_COOKIE,
        token,
        max_age=max_age,
        path=COOKIE_PATH,
        httponly=True,
        secure=_is_https(request),
        samesite="strict",
    )
    logger.info("Admin %s logged in from %s", credentials["username"], client)
    return {"username": credentials["username"]}


@router.post("/logout", status_code=204, dependencies=[Depends(require_admin_header)])
async def logout(
    request: Request, repo: AdminRepository = Depends(get_admin_repository)
) -> Response:
    """End the current admin session (idempotent)."""
    for token in cookie_values(request, SESSION_COOKIE):
        await repo.delete_session(hash_session_token(token))
    response = Response(status_code=204)
    response.delete_cookie(SESSION_COOKIE, path=COOKIE_PATH)
    response.delete_cookie(SESSION_COOKIE, path=LEGACY_COOKIE_PATH)
    return response


@router.get("/session")
async def session(admin: dict = Depends(require_admin)) -> dict:
    """The logged-in admin."""
    return {"username": admin["username"]}


@router.get("/settings")
async def get_runtime_settings(
    _admin: dict = Depends(require_admin),
    repo: AdminRepository = Depends(get_admin_repository),
    settings: Settings = Depends(get_settings),
) -> dict:
    """Current runtime settings, their defaults, and the restart-only config."""
    service = RuntimeSettingsService(settings, repo)
    system = settings.system_info()
    return {
        "settings": (await service.get()).model_dump(),
        "defaults": service.defaults().model_dump(),
        "allowed_models": service.allowed_models(),
        "languages": sorted(WHISPER_LANGUAGE_CODES),
        "restart_only": {
            "hardware_profile": system["resolved_profile"],
            "device": system["device"],
            "compute_type": system["compute_type"],
            "diarization_model": system["pyannote_model_name"],
        },
        # Prompt parts the code depends on, shown read-only.
        "fixed_prompts": {
            "translation_output_contract": TRANSLATION_OUTPUT_CONTRACT,
            "qwen3_no_think": QWEN3_NO_THINK,
        },
    }


@router.put("/settings", dependencies=[Depends(require_admin_header)])
async def update_runtime_settings(
    body: RuntimeSettings,
    admin: dict = Depends(require_admin),
    repo: AdminRepository = Depends(get_admin_repository),
    settings: Settings = Depends(get_settings),
) -> dict:
    """Replace the runtime settings; applies to jobs started from now on."""
    service = RuntimeSettingsService(settings, repo)
    try:
        changed = await service.update(body, admin["username"])
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e)) from e
    return {"settings": (await service.get()).model_dump(), "changed": changed}


@router.get("/audit")
async def audit_log(
    limit: int = Query(default=100, ge=1, le=500),
    _admin: dict = Depends(require_admin),
    repo: AdminRepository = Depends(get_admin_repository),
) -> list[dict]:
    """Settings change history, newest first."""
    return await repo.list_audit(limit)


@router.post("/password", status_code=204, dependencies=[Depends(require_admin_header)])
async def change_password(
    body: PasswordChangeRequest,
    admin: dict = Depends(require_admin),
    repo: AdminRepository = Depends(get_admin_repository),
) -> Response:
    """Change the admin password and sign out every other session."""
    credentials = await repo.get_credentials()
    if credentials is None or not await _verify_password(
        body.current_password, credentials["password_hash"]
    ):
        raise HTTPException(status_code=403, detail="Current password is incorrect.")
    problem = password_problem(body.new_password)
    if problem:
        raise HTTPException(status_code=422, detail=problem)
    if body.new_password == body.current_password:
        raise HTTPException(
            status_code=422, detail="New password must differ from the current one."
        )

    loop = asyncio.get_running_loop()
    new_hash = await loop.run_in_executor(None, hash_password, body.new_password)
    await repo.update_password(admin["username"], new_hash, admin["token_hash"])
    logger.info("Admin %s changed the password", admin["username"])
    return Response(status_code=204)


# ============================================================================
# User accounts
# ============================================================================

USERNAME_PATTERN = r"^[A-Za-z0-9._@-]{3,100}$"


MAX_TOKEN_CHANGE = 10000


class UserCreateRequest(BaseModel):
    """A new user account, with a temporary password and a starting balance."""
    username: str = Field(pattern=USERNAME_PATTERN)
    display_name: str = Field(min_length=1, max_length=200)
    password: str = Field(min_length=1, max_length=MAX_PASSWORD_LENGTH)
    initial_tokens: int = Field(default=0, ge=0, le=MAX_TOKEN_CHANGE)


class TokenChangeRequest(BaseModel):
    """Tokens to give (positive) or take (negative), with an optional reason."""
    delta: int = Field(ge=-MAX_TOKEN_CHANGE, le=MAX_TOKEN_CHANGE)
    note: Optional[str] = Field(default=None, max_length=500)

    @field_validator("delta")
    @classmethod
    def _not_zero(cls, delta: int) -> int:
        if delta == 0:
            raise ValueError("delta must not be zero")
        return delta

    @field_validator("note", mode="before")
    @classmethod
    def _strip(cls, note):
        if isinstance(note, str):
            return note.strip() or None
        return note


class UserUpdateRequest(BaseModel):
    """Changes to an account; omitted fields stay as they are."""
    display_name: Optional[str] = Field(default=None, min_length=1, max_length=200)
    is_active: Optional[bool] = None


class PasswordResetRequest(BaseModel):
    """A temporary password the user must replace at next login."""
    password: str = Field(min_length=1, max_length=MAX_PASSWORD_LENGTH)


def get_user_service(settings: Settings = Depends(get_settings)) -> UserService:
    """UserService dependency."""
    return UserService(settings)


async def _user_or_404(users: UserRepository, user_uuid: UUID) -> dict:
    user = await users.get(str(user_uuid))
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return user


@router.get("/users")
async def list_users(
    _admin: dict = Depends(require_admin),
    users: UserRepository = Depends(get_user_repository),
) -> list[dict]:
    """Every account, with how many projects and audios it owns."""
    return await users.list_with_counts()


@router.post("/users", status_code=201, dependencies=[Depends(require_admin_header)])
async def create_user(
    body: UserCreateRequest,
    admin: dict = Depends(require_admin),
    repo: AdminRepository = Depends(get_admin_repository),
    service: UserService = Depends(get_user_service),
    tokens: TokenRepository = Depends(get_token_repository),
) -> dict:
    """Create an account; the user must choose a new password at first login."""
    problem = password_problem(body.password)
    if problem:
        raise HTTPException(status_code=422, detail=problem)
    try:
        user = await service.create(body.username, body.display_name.strip(), body.password)
    except UsernameTakenError as e:
        raise HTTPException(status_code=409, detail="This username is already taken.") from e
    await repo.record_audit(admin["username"], "user_created", None, user["username"])
    if body.initial_tokens:
        user["token_balance"] = await tokens.adjust(
            str(user["uuid"]), body.initial_tokens, admin["username"], "Initial tokens"
        )
        await repo.record_audit(
            admin["username"], "user_tokens", 0, user["token_balance"]
        )
    logger.info("Admin %s created user %s", admin["username"], user["username"])
    return user


@router.patch("/users/{user_uuid}", dependencies=[Depends(require_admin_header)])
async def update_user(
    user_uuid: UUID,
    body: UserUpdateRequest,
    admin: dict = Depends(require_admin),
    repo: AdminRepository = Depends(get_admin_repository),
    users: UserRepository = Depends(get_user_repository),
) -> dict:
    """Rename an account or (de)activate it; deactivating signs the user out."""
    before = await _user_or_404(users, user_uuid)
    user = await users.update(str(user_uuid), body.display_name, body.is_active)
    if body.display_name is not None and body.display_name != before["display_name"]:
        await repo.record_audit(
            admin["username"], "user_renamed", before["display_name"], user["display_name"]
        )
    if body.is_active is not None and body.is_active != before["is_active"]:
        key = "user_activated" if body.is_active else "user_deactivated"
        await repo.record_audit(admin["username"], key, None, user["username"])
    return user


@router.post(
    "/users/{user_uuid}/password", status_code=204, dependencies=[Depends(require_admin_header)]
)
async def reset_user_password(
    user_uuid: UUID,
    body: PasswordResetRequest,
    admin: dict = Depends(require_admin),
    repo: AdminRepository = Depends(get_admin_repository),
    users: UserRepository = Depends(get_user_repository),
    service: UserService = Depends(get_user_service),
) -> Response:
    """Set a temporary password and sign the user out everywhere."""
    user = await _user_or_404(users, user_uuid)
    problem = password_problem(body.password)
    if problem:
        raise HTTPException(status_code=422, detail=problem)
    await service.reset_password(str(user_uuid), body.password)
    await repo.record_audit(admin["username"], "user_password_reset", None, user["username"])
    return Response(status_code=204)


@router.delete("/users/{user_uuid}", status_code=204, dependencies=[Depends(require_admin_header)])
async def delete_user(
    user_uuid: UUID,
    admin: dict = Depends(require_admin),
    repo: AdminRepository = Depends(get_admin_repository),
    users: UserRepository = Depends(get_user_repository),
    service: UserService = Depends(get_user_service),
) -> Response:
    """Delete the account and every audio, project and file it owns."""
    user = await _user_or_404(users, user_uuid)
    await service.delete(str(user_uuid))
    await repo.record_audit(admin["username"], "user_deleted", user["username"], None)
    logger.info("Admin %s deleted user %s", admin["username"], user["username"])
    return Response(status_code=204)


@router.get("/users/{user_uuid}/content")
async def user_content(
    user_uuid: UUID,
    _admin: dict = Depends(require_admin),
    users: UserRepository = Depends(get_user_repository),
) -> dict:
    """The account's projects and audios (outside projects), to open in the app."""
    await _user_or_404(users, user_uuid)
    return await users.content(str(user_uuid))


@router.post("/users/{user_uuid}/tokens", dependencies=[Depends(require_admin_header)])
async def change_user_tokens(
    user_uuid: UUID,
    body: TokenChangeRequest,
    admin: dict = Depends(require_admin),
    repo: AdminRepository = Depends(get_admin_repository),
    users: UserRepository = Depends(get_user_repository),
    tokens: TokenRepository = Depends(get_token_repository),
) -> dict:
    """Give or take tokens; the balance never drops below zero."""
    user = await _user_or_404(users, user_uuid)
    try:
        balance = await tokens.adjust(str(user_uuid), body.delta, admin["username"], body.note)
    except NegativeBalanceError as e:
        raise HTTPException(
            status_code=409,
            detail=f"The user has only {e.args[0]} token(s); the balance cannot go below zero.",
        ) from e
    if balance is None:
        raise HTTPException(status_code=404, detail="User not found")
    await repo.record_audit(
        admin["username"], "user_tokens", user["token_balance"], balance
    )
    logger.info(
        "Admin %s changed %s's tokens by %+d to %d",
        admin["username"], user["username"], body.delta, balance,
    )
    return {"token_balance": balance}


@router.get("/users/{user_uuid}/tokens")
async def user_token_history(
    user_uuid: UUID,
    limit: int = Query(default=200, ge=1, le=1000),
    _admin: dict = Depends(require_admin),
    users: UserRepository = Depends(get_user_repository),
    tokens: TokenRepository = Depends(get_token_repository),
) -> dict:
    """The balance and every token movement, newest first."""
    user = await _user_or_404(users, user_uuid)
    return {
        "token_balance": user["token_balance"],
        "transactions": await tokens.history(str(user_uuid), limit),
    }
