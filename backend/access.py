"""
Who is calling, and what they may touch.

Users sign in with a session cookie; the administrator's own session (from the
admin panel) is accepted too and may see everything. Each audio (job) and
project belongs to one user: anyone else gets a 404, so they cannot even learn
that it exists. State-changing requests must carry a custom header, which a
cross-site form cannot send.
"""
from dataclasses import dataclass
from typing import Optional
from uuid import UUID

from admin_auth import hash_session_token
from dependencies import (
    get_admin_repository,
    get_job_repository,
    get_project_repository,
    get_user_repository,
)
from fastapi import Depends, HTTPException, Request

USER_COOKIE = "meetmemo_session"
ADMIN_COOKIE = "meetmemo_admin"
# Both cookies cover the whole API: the audio player's <audio src> and the
# admin's view of users' content need them outside /auth and /admin.
COOKIE_PATH = "/api/v1"

# 402 detail when an upload finds no token left.
NO_TOKENS_DETAIL = "No tokens left. Ask the administrator for more."

REQUEST_HEADER = "x-meetmemo-request"
ADMIN_HEADER = "x-meetmemo-admin"
_UNSAFE_METHODS = frozenset({"POST", "PUT", "PATCH", "DELETE"})


@dataclass(frozen=True)
class Principal:
    """The signed-in user, or the administrator (who has no user account)."""

    username: str
    user_uuid: Optional[str] = None
    display_name: Optional[str] = None
    is_admin: bool = False
    must_change_password: bool = False

    def may_access(self, owner_uuid) -> bool:
        """Whether this principal may see and change something owned by `owner_uuid`."""
        return self.is_admin or (
            self.user_uuid is not None and owner_uuid is not None
            and str(owner_uuid) == self.user_uuid
        )


def cookie_values(request: Request, name: str) -> list[str]:
    """
    Every value the browser sent for a cookie name.

    A browser can hold the same name at several paths (the admin cookie used to
    live at /api/v1/admin) and sends all of them; each is tried in turn.
    """
    values = []
    for part in request.headers.get("cookie", "").split(";"):
        key, sep, value = part.strip().partition("=")
        if sep and key == name and value:
            values.append(value)
    return values


def client_key(request: Request) -> str:
    """The client's address, for login rate limiting (nginx sets X-Real-IP)."""
    return request.headers.get("x-real-ip") or (
        request.client.host if request.client else "unknown"
    )


def is_https(request: Request) -> bool:
    """Whether the browser reached us over HTTPS (possibly through a proxy)."""
    proto = request.headers.get("x-forwarded-proto") or request.url.scheme
    return proto.split(",")[0].strip().lower() == "https"


async def require_request_header(request: Request) -> None:
    """Reject state-changing requests without the application's custom header."""
    if request.method in _UNSAFE_METHODS and "1" not in (
        request.headers.get(REQUEST_HEADER), request.headers.get(ADMIN_HEADER)
    ):
        raise HTTPException(status_code=403, detail="Missing request header")


async def get_session_principal(
    request: Request,
    users=Depends(get_user_repository),
    admins=Depends(get_admin_repository),
) -> Principal:
    """The signed-in user or administrator, or 401."""
    for token in cookie_values(request, USER_COOKIE):
        user = await users.get_session_user(hash_session_token(token))
        if user:
            return Principal(
                username=user["username"],
                user_uuid=str(user["uuid"]),
                display_name=user["display_name"],
                must_change_password=user["must_change_password"],
            )
    for token in cookie_values(request, ADMIN_COOKIE):
        session = await admins.get_session(hash_session_token(token))
        if session:
            return Principal(username=session["username"], is_admin=True)
    raise HTTPException(status_code=401, detail="Not authenticated")


async def get_principal(principal: Principal = Depends(get_session_principal)) -> Principal:
    """Like get_session_principal, but a user must first replace a temporary password."""
    if principal.must_change_password:
        raise HTTPException(status_code=403, detail="Password change required")
    return principal


async def require_user(principal: Principal = Depends(get_principal)) -> Principal:
    """Only a user account (audios and projects always belong to one)."""
    if principal.user_uuid is None:
        raise HTTPException(
            status_code=403,
            detail="The administrator cannot upload audios; sign in with a user account.",
        )
    return principal


def _parse_uuid(value) -> Optional[str]:
    try:
        return str(UUID(str(value)))
    except ValueError:
        return None


async def get_owned_job(
    uuid: str,
    principal: Principal = Depends(get_principal),
    job_repo=Depends(get_job_repository),
) -> dict:
    """The job in the path, if the caller may access it; 404 otherwise."""
    job_uuid = _parse_uuid(uuid)
    job = await job_repo.get(job_uuid) if job_uuid else None
    if not job or not principal.may_access(job.get("user_uuid")):
        raise HTTPException(status_code=404, detail=f"Job {uuid} not found")
    return job


async def authorize_path(
    request: Request,
    principal: Principal = Depends(get_principal),
    job_repo=Depends(get_job_repository),
    project_repo=Depends(get_project_repository),
) -> Principal:
    """
    Router-wide guard: a signed-in caller, who may access the job (``{uuid}``)
    and the project (``{project_uuid}``) named in the path, if any.
    """
    job_uuid = request.path_params.get("uuid")
    if job_uuid is not None:
        await get_owned_job(job_uuid, principal, job_repo)
    project_uuid = request.path_params.get("project_uuid")
    if project_uuid is not None:
        parsed = _parse_uuid(project_uuid)
        if parsed is None:
            raise HTTPException(status_code=404, detail="Project not found")
        await get_owned_project(UUID(parsed), principal, project_repo)
    return principal


async def get_owned_project(
    project_uuid: UUID,
    principal: Principal = Depends(get_principal),
    repo=Depends(get_project_repository),
) -> dict:
    """The project in the path, if the caller may access it; 404 otherwise."""
    project = await repo.get(str(project_uuid))
    if not project or not principal.may_access(project.get("user_uuid")):
        raise HTTPException(status_code=404, detail="Project not found")
    return project
