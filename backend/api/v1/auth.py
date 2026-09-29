"""
User sign-in: login/logout, the current account, and password change.

Sessions are server-side: the browser holds a random token in an HttpOnly,
SameSite=Strict cookie, and the database holds only its SHA-256. Accounts are
created by the administrator; there is no sign-up.
"""
import asyncio
import logging
from datetime import datetime, timedelta, timezone
from typing import Optional

from access import (
    COOKIE_PATH,
    USER_COOKIE,
    Principal,
    client_key,
    cookie_values,
    get_session_principal,
    is_https,
    require_request_header,
    token_state,
)
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
from dependencies import get_user_repository
from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, Field
from repositories.user_repository import UserRepository

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


@router.post("/login")
async def login(
    body: LoginRequest,
    request: Request,
    response: Response,
    users: UserRepository = Depends(get_user_repository),
    settings: Settings = Depends(get_settings),
) -> dict:
    """Start a user session."""
    client = client_key(request)
    if _rate_limiter.is_blocked(client):
        raise HTTPException(
            status_code=429, detail="Too many failed attempts. Try again later."
        )

    account = await users.get_credentials(body.username.strip())
    # Always run the (slow) hash check so timing doesn't reveal the username.
    stored_hash = account["password_hash"] if account else DUMMY_PASSWORD_HASH
    password_ok = await _verify(body.password, stored_hash)
    if not (account and account["is_active"] and password_ok):
        _rate_limiter.record_failure(client)
        logger.warning("Failed user login from %s", client)
        raise HTTPException(status_code=401, detail="Invalid username or password.")

    _rate_limiter.reset(client)
    token = new_session_token()
    max_age = settings.user_session_hours * 3600
    await users.create_session(
        hash_session_token(token),
        str(account["uuid"]),
        datetime.now(timezone.utc) + timedelta(seconds=max_age),
    )
    response.set_cookie(
        USER_COOKIE,
        token,
        max_age=max_age,
        path=COOKIE_PATH,
        httponly=True,
        secure=is_https(request),
        samesite="strict",
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
    request: Request, users: UserRepository = Depends(get_user_repository)
) -> Response:
    """End the current user session (idempotent)."""
    for token in cookie_values(request, USER_COOKIE):
        await users.delete_session(hash_session_token(token))
    response = Response(status_code=204)
    response.delete_cookie(USER_COOKIE, path=COOKIE_PATH)
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
