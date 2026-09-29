"""
Sign-in for everyone: login/logout, the current account, and password change.

Users and the administrator sign in on the same page: a username equal to the
administrator's opens an administrator session, any other a user session.
Sessions are server-side: the browser holds a random token in an HttpOnly,
SameSite=Strict cookie, and the database holds only its SHA-256. Accounts are
created by the administrator; there is no sign-up.
"""
import asyncio
import hmac
import logging
from typing import Optional

from access import (
    USER_COOKIE,
    Principal,
    client_key,
    cookie_values,
    get_session_principal,
    require_request_header,
    token_state,
)
from admin_auth import (
    DUMMY_PASSWORD_HASH,
    MAX_PASSWORD_LENGTH,
    LoginRateLimiter,
    hash_password,
    hash_session_token,
    password_problem,
    verify_password,
)
from config import Settings, get_settings
from dependencies import get_admin_repository, get_user_repository
from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, Field
from repositories.admin_repository import AdminRepository
from repositories.user_repository import UserRepository
from sessions import (
    close_admin_sessions,
    close_user_sessions,
    open_admin_session,
    open_user_session,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/auth", dependencies=[Depends(require_request_header)])

_rate_limiter = LoginRateLimiter()


class LoginRequest(BaseModel):
    """User login credentials."""
    username: str = Field(min_length=1, max_length=100)
    password: str = Field(min_length=1, max_length=MAX_PASSWORD_LENGTH)


class PasswordChangeRequest(BaseModel):
    """A user changing their own password."""
    current_password: str = Field(min_length=1, max_length=MAX_PASSWORD_LENGTH)
    new_password: str = Field(min_length=1, max_length=MAX_PASSWORD_LENGTH)


async def _verify(password: str, stored_hash: str) -> bool:
    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(None, verify_password, password, stored_hash)


def _me(principal: Principal, account: Optional[dict] = None) -> dict:
    return {
        "username": principal.username,
        "display_name": principal.display_name,
        "is_admin": principal.is_admin,
        "must_change_password": principal.must_change_password,
        # All None for the administrator, who has no account and uploads nothing.
        **token_state(account),
    }


def _is_admin_username(username: str, credentials: Optional[dict]) -> bool:
    return credentials is not None and hmac.compare_digest(
        username.encode("utf-8"), credentials["username"].encode("utf-8")
    )


@router.post("/login")
async def login(
    body: LoginRequest,
    request: Request,
    response: Response,
    users: UserRepository = Depends(get_user_repository),
    admins: AdminRepository = Depends(get_admin_repository),
    settings: Settings = Depends(get_settings),
) -> dict:
    """Start a session, as the administrator or as a user, depending on the username."""
    client = client_key(request)
    if _rate_limiter.is_blocked(client):
        raise HTTPException(
            status_code=429, detail="Too many failed attempts. Try again later."
        )

    username = body.username.strip()
    try:
        admin = await admins.get_credentials()
    except Exception:  # pylint: disable=broad-exception-caught
        # The admin panel is optional (see main.py): users still sign in.
        logger.error("Admin account unavailable; only users can sign in", exc_info=True)
        admin = None
    as_admin = _is_admin_username(username, admin)
    account = None if as_admin else await users.get_credentials(username)
    # Always exactly one (slow) hash check, so neither timing nor the error
    # reveals whether the username exists or belongs to the administrator.
    if as_admin:
        stored_hash = admin["password_hash"]
    else:
        stored_hash = account["password_hash"] if account else DUMMY_PASSWORD_HASH
    password_ok = await _verify(body.password, stored_hash)
    if not password_ok or not (as_admin or (account and account["is_active"])):
        _rate_limiter.record_failure(client)
        logger.warning("Failed login from %s", client)
        raise HTTPException(status_code=401, detail="Invalid username or password.")

    _rate_limiter.reset(client)
    if as_admin:
        await open_admin_session(
            request, response, users, admins, admin["username"],
            settings.admin_session_hours,
        )
        logger.info("Admin %s logged in from %s", admin["username"], client)
        return _me(Principal(username=admin["username"], is_admin=True))

    await open_user_session(
        request, response, users, admins, str(account["uuid"]), settings.user_session_hours
    )
    logger.info("User %s logged in from %s", account["username"], client)
    user = await users.get(str(account["uuid"]))
    return {
        "username": user["username"],
        "display_name": user["display_name"],
        "is_admin": False,
        "must_change_password": user["must_change_password"],
        **token_state(user),
    }


@router.post("/logout", status_code=204)
async def logout(
    request: Request,
    users: UserRepository = Depends(get_user_repository),
    admins: AdminRepository = Depends(get_admin_repository),
) -> Response:
    """End the current session, user or administrator (idempotent)."""
    response = Response(status_code=204)
    await close_user_sessions(request, response, users)
    await close_admin_sessions(request, response, admins)
    return response


@router.get("/me")
async def me(
    principal: Principal = Depends(get_session_principal),
    users: UserRepository = Depends(get_user_repository),
) -> dict:
    """The signed-in user (or administrator), with the user's tokens."""
    account = await users.get(principal.user_uuid) if principal.user_uuid else None
    return _me(principal, account)


@router.post("/password", status_code=204)
async def change_password(
    body: PasswordChangeRequest,
    request: Request,
    principal: Principal = Depends(get_session_principal),
    users: UserRepository = Depends(get_user_repository),
) -> Response:
    """Change the user's own password and sign out their other sessions."""
    if principal.user_uuid is None:
        raise HTTPException(
            status_code=403, detail="Change the administrator password in the admin panel."
        )
    stored_hash = await users.get_password_hash(principal.user_uuid)
    if not stored_hash or not await _verify(body.current_password, stored_hash):
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
    current = [hash_session_token(t) for t in cookie_values(request, USER_COOKIE)]
    await users.set_password(
        principal.user_uuid, new_hash, must_change=False,
        keep_session_hash=current[0] if current else None,
    )
    logger.info("User %s changed their password", principal.username)
    return Response(status_code=204)
