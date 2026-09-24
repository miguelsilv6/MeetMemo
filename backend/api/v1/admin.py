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
from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from pydantic import BaseModel, Field
from repositories.admin_repository import AdminRepository
from runtime_settings import WHISPER_LANGUAGE_CODES, RuntimeSettings
from services.runtime_settings_service import RuntimeSettingsService

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/admin")

SESSION_COOKIE = "meetmemo_admin"
COOKIE_PATH = "/api/v1/admin"
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


def get_admin_repository() -> AdminRepository:
    """AdminRepository dependency."""
    return AdminRepository()


def _client_key(request: Request) -> str:
    # The backend is only reachable through nginx, which sets X-Real-IP.
    return request.headers.get("x-real-ip") or (request.client.host if request.client else "unknown")


def _is_https(request: Request) -> bool:
    proto = request.headers.get("x-forwarded-proto") or request.url.scheme
    return proto.split(",")[0].strip().lower() == "https"


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
    token = request.cookies.get(SESSION_COOKIE)
    if token:
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
    token = request.cookies.get(SESSION_COOKIE)
    if token:
        await repo.delete_session(hash_session_token(token))
    response = Response(status_code=204)
    response.delete_cookie(SESSION_COOKIE, path=COOKIE_PATH)
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
