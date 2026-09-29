"""
Opening and closing sign-in sessions, for users and for the administrator.

Both sign in on the same page (POST /auth/login). Each kind has its own cookie
and table; opening one closes the other, so a browser is only ever signed in
as one of them (a user session would otherwise take precedence when resolving
who is calling).
"""
from datetime import datetime, timedelta, timezone

from access import ADMIN_COOKIE, COOKIE_PATH, USER_COOKIE, cookie_values, is_https
from admin_auth import hash_session_token, new_session_token
from fastapi import Request, Response

# Admin sessions from before lived at this path; that copy is removed too.
LEGACY_ADMIN_COOKIE_PATH = "/api/v1/admin"


def _set_cookie(response: Response, request: Request, name: str, token: str, max_age: int):
    response.set_cookie(
        name,
        token,
        max_age=max_age,
        path=COOKIE_PATH,
        httponly=True,
        secure=is_https(request),
        samesite="strict",
    )


async def close_user_sessions(request: Request, response: Response, users) -> None:
    """End the user sessions this browser holds, and clear their cookie."""
    for token in cookie_values(request, USER_COOKIE):
        await users.delete_session(hash_session_token(token))
    response.delete_cookie(USER_COOKIE, path=COOKIE_PATH)


async def close_admin_sessions(request: Request, response: Response, admins) -> None:
    """End the administrator sessions this browser holds, and clear their cookies."""
    for token in cookie_values(request, ADMIN_COOKIE):
        await admins.delete_session(hash_session_token(token))
    response.delete_cookie(ADMIN_COOKIE, path=COOKIE_PATH)
    response.delete_cookie(ADMIN_COOKIE, path=LEGACY_ADMIN_COOKIE_PATH)


async def open_user_session(
    request: Request, response: Response, users, admins, user_uuid: str, hours: int
) -> None:
    """Sign the browser in as a user (ending any administrator session it had)."""
    await close_admin_sessions(request, response, admins)
    token = new_session_token()
    max_age = hours * 3600
    await users.create_session(
        hash_session_token(token),
        user_uuid,
        datetime.now(timezone.utc) + timedelta(seconds=max_age),
    )
    _set_cookie(response, request, USER_COOKIE, token, max_age)


async def open_admin_session(
    request: Request, response: Response, users, admins, username: str, hours: int
) -> None:
    """Sign the browser in as the administrator (ending any user session it had)."""
    await close_user_sessions(request, response, users)
    # A copy at the old path would be sent alongside the new one: drop it.
    response.delete_cookie(ADMIN_COOKIE, path=LEGACY_ADMIN_COOKIE_PATH)
    token = new_session_token()
    max_age = hours * 3600
    await admins.create_session(
        hash_session_token(token),
        username,
        datetime.now(timezone.utc) + timedelta(seconds=max_age),
    )
    _set_cookie(response, request, ADMIN_COOKIE, token, max_age)
