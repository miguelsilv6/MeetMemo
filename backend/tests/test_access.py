"""Who may call what: sessions, the request header, ownership and login limits."""
import asyncio
import importlib.util
from pathlib import Path
from types import SimpleNamespace

import pytest
from access import (
    Principal,
    cookie_values,
    get_owned_job,
    get_principal,
    require_request_header,
)
from admin_auth import DUMMY_PASSWORD_HASH, LoginRateLimiter
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

ANA = "1b4e28ba-2fa1-11d2-883f-0016d3cca427"
BRUNO = "6f1c2e0a-7d33-4b8e-9a51-0c3d2b1a9f10"
JOB = "3c8c40cd-9fec-49aa-a7ab-b657726e4cb6"


def _request(method="GET", headers=None):
    return SimpleNamespace(method=method, headers=headers or {})


def test_every_copy_of_a_cookie_is_found():
    request = _request(headers={"cookie": "meetmemo_admin=old; theme=x; meetmemo_admin=new"})
    assert cookie_values(request, "meetmemo_admin") == ["old", "new"]
    assert cookie_values(_request(), "meetmemo_admin") == []


@pytest.mark.parametrize("method", ["POST", "PUT", "PATCH", "DELETE"])
def test_state_changing_requests_need_the_custom_header(method):
    with pytest.raises(HTTPException) as excinfo:
        asyncio.run(require_request_header(_request(method)))
    assert excinfo.value.status_code == 403
    asyncio.run(require_request_header(_request(method, {"x-meetmemo-request": "1"})))
    asyncio.run(require_request_header(_request(method, {"x-meetmemo-admin": "1"})))


def test_reads_need_no_header():
    asyncio.run(require_request_header(_request("GET")))


def test_a_temporary_password_must_be_replaced_first():
    with pytest.raises(HTTPException) as excinfo:
        asyncio.run(get_principal(Principal("ana", ANA, must_change_password=True)))
    assert excinfo.value.status_code == 403


class _Jobs:
    async def get(self, uuid):
        return {"uuid": uuid, "user_uuid": ANA} if uuid == JOB else None


@pytest.mark.parametrize("principal, allowed", [
    (Principal("ana", ANA), True),
    (Principal("bruno", BRUNO), False),
    (Principal("admin", is_admin=True), True),
])
def test_only_the_owner_or_the_administrator_reaches_a_job(principal, allowed):
    if allowed:
        assert asyncio.run(get_owned_job(JOB, principal, _Jobs()))["uuid"] == JOB
    else:
        with pytest.raises(HTTPException) as excinfo:
            asyncio.run(get_owned_job(JOB, principal, _Jobs()))
        # Not 403: another user's job looks exactly like one that doesn't exist.
        assert excinfo.value.status_code == 404


@pytest.mark.parametrize("uuid", ["not-a-uuid", "../etc/passwd", ""])
def test_malformed_job_ids_are_simply_not_found(uuid):
    with pytest.raises(HTTPException) as excinfo:
        asyncio.run(get_owned_job(uuid, Principal("admin", is_admin=True), _Jobs()))
    assert excinfo.value.status_code == 404


def test_repeated_failed_logins_are_blocked():
    spec = importlib.util.spec_from_file_location(
        "auth_api_under_test", Path(__file__).resolve().parents[1] / "api" / "v1" / "auth.py"
    )
    auth_api = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(auth_api)
    auth_api._rate_limiter = LoginRateLimiter(max_failures=3)  # pylint: disable=protected-access

    class NoUsers:
        async def get_credentials(self, username):
            return None

    class Admin:
        async def get_credentials(self):
            return {"username": "admin", "password_hash": DUMMY_PASSWORD_HASH}

    app = FastAPI()
    app.include_router(auth_api.router, prefix="/api/v1")
    app.dependency_overrides[auth_api.get_user_repository] = NoUsers
    app.dependency_overrides[auth_api.get_admin_repository] = Admin
    app.dependency_overrides[auth_api.get_settings] = lambda: SimpleNamespace(
        user_session_hours=12
    )
    client = TestClient(app, headers={"X-MeetMemo-Request": "1"})
    body = {"username": "ana", "password": "guess"}

    # Wrong guesses for a user and for the administrator count together.
    admin_guess = {"username": "admin", "password": "guess"}
    assert [client.post("/api/v1/auth/login", json=b).status_code
            for b in (body, admin_guess, body)] == [401, 401, 401]
    assert client.post("/api/v1/auth/login", json=body).status_code == 429
    assert client.post("/api/v1/auth/login", json=body, headers={"X-MeetMemo-Request": ""}
                       ).status_code == 403


def test_users_still_sign_in_when_the_admin_account_is_unavailable():
    spec = importlib.util.spec_from_file_location(
        "auth_api_no_admin", Path(__file__).resolve().parents[1] / "api" / "v1" / "auth.py"
    )
    auth_api = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(auth_api)

    class NoUsers:
        async def get_credentials(self, username):
            return None

    class BrokenAdmin:
        async def get_credentials(self):
            raise RuntimeError("relation admin_credentials does not exist")

    app = FastAPI()
    app.include_router(auth_api.router, prefix="/api/v1")
    app.dependency_overrides[auth_api.get_user_repository] = NoUsers
    app.dependency_overrides[auth_api.get_admin_repository] = BrokenAdmin
    app.dependency_overrides[auth_api.get_settings] = lambda: SimpleNamespace(
        user_session_hours=12, admin_session_hours=8
    )
    client = TestClient(app, headers={"X-MeetMemo-Request": "1"})
    response = client.post("/api/v1/auth/login", json={"username": "admin", "password": "x"})
    assert response.status_code == 401  # a normal failed login, not a server error

