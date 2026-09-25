"""
HTTP-level tests for the admin API, using the real router with an in-memory
repository in place of PostgreSQL.

admin.py is loaded straight from its file: importing it through the api.v1
package would import every router, including ones that need torch.
"""
import importlib.util
from datetime import datetime, timezone
from pathlib import Path

import pytest
from admin_auth import LoginRateLimiter, hash_password, hash_session_token
from fastapi import FastAPI
from fastapi.testclient import TestClient

_spec = importlib.util.spec_from_file_location(
    "admin_api_under_test", Path(__file__).resolve().parents[1] / "api" / "v1" / "admin.py"
)
admin_api = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(admin_api)

PASSWORD = "a long enough password"
HEADERS = {"X-MeetMemo-Admin": "1"}


class FakeAdminRepository:
    def __init__(self, configured: bool = True):
        self.credentials = (
            {"username": "admin", "password_hash": hash_password(PASSWORD)} if configured else None
        )
        self.sessions: dict[str, dict] = {}
        self.settings = None
        self.audit: list[tuple] = []

    async def get_credentials(self):
        return self.credentials

    async def create_session(self, token_hash, username, expires_at):
        self.sessions[token_hash] = {"username": username, "expires_at": expires_at}

    async def get_session(self, token_hash):
        session = self.sessions.get(token_hash)
        if session and session["expires_at"] > datetime.now(timezone.utc):
            return session
        return None

    async def delete_session(self, token_hash):
        self.sessions.pop(token_hash, None)

    async def update_password(self, username, password_hash, keep_session_hash):
        self.credentials["password_hash"] = password_hash
        self.sessions = {k: v for k, v in self.sessions.items() if k == keep_session_hash}
        self.audit.append((username, "admin_password", None, None))

    async def get_runtime_settings(self):
        return self.settings

    async def save_runtime_settings(self, data, actor, changes):
        self.settings = data
        self.audit.extend((actor, key, old, new) for key, old, new in changes)

    async def list_audit(self, limit=100):
        return [
            {"actor": a, "setting_key": k, "old_value": o, "new_value": n}
            for a, k, o, n in reversed(self.audit)
        ][:limit]


class StubSettings:
    whisper_model_name = "large-v3"
    job_retention_hours = 12
    admin_session_hours = 8

    def system_info(self):
        return {
            "resolved_profile": "cpu",
            "device": "cpu",
            "compute_type": "int8",
            "pyannote_model_name": "pyannote/speaker-diarization-3.1",
        }


def make_client(repo: FakeAdminRepository) -> TestClient:
    app = FastAPI()
    app.include_router(admin_api.router, prefix="/api/v1")
    app.dependency_overrides[admin_api.get_admin_repository] = lambda: repo
    app.dependency_overrides[admin_api.get_settings] = StubSettings
    return TestClient(app)


@pytest.fixture(autouse=True)
def fresh_rate_limiter():
    admin_api._rate_limiter = LoginRateLimiter()  # pylint: disable=protected-access


@pytest.fixture
def repo():
    return FakeAdminRepository()


@pytest.fixture
def client(repo):
    return make_client(repo)


def login(client, password=PASSWORD, username="admin", headers=HEADERS):
    return client.post(
        "/api/v1/admin/login", json={"username": username, "password": password}, headers=headers
    )


def test_status_reports_whether_an_admin_exists():
    assert make_client(FakeAdminRepository()).get("/api/v1/admin/status").json() == {"configured": True}
    assert make_client(FakeAdminRepository(configured=False)).get(
        "/api/v1/admin/status"
    ).json() == {"configured": False}


def test_login_requires_the_admin_header(client):
    assert login(client, headers={}).status_code == 403


def test_login_when_no_admin_is_configured():
    assert login(make_client(FakeAdminRepository(configured=False))).status_code == 503


def test_wrong_credentials_get_the_same_generic_error(client):
    wrong_password = login(client, password="not the password")
    wrong_user = login(client, username="root")
    assert wrong_password.status_code == wrong_user.status_code == 401
    assert wrong_password.json() == wrong_user.json()


def test_successful_login_sets_a_hardened_cookie_and_stores_only_its_hash(client, repo):
    response = login(client)
    assert response.status_code == 200
    assert response.json() == {"username": "admin"}

    set_cookie = response.headers["set-cookie"].lower()
    assert "httponly" in set_cookie
    assert "samesite=strict" in set_cookie
    assert "path=/api/v1/admin" in set_cookie

    token = response.cookies.get(admin_api.SESSION_COOKIE)
    assert token and token not in repo.sessions
    assert hash_session_token(token) in repo.sessions

    assert client.get("/api/v1/admin/session").json() == {"username": "admin"}


def test_cookie_is_secure_behind_an_https_proxy(client):
    response = login(client, headers={**HEADERS, "X-Forwarded-Proto": "https"})
    assert "secure" in response.headers["set-cookie"].lower()


def test_repeated_failures_lock_out_even_the_right_password(client):
    for _ in range(5):
        assert login(client, password="nope nope nope").status_code == 401
    assert login(client).status_code == 429


def test_protected_endpoints_require_a_session(client):
    assert client.get("/api/v1/admin/session").status_code == 401
    assert client.get("/api/v1/admin/settings").status_code == 401
    assert client.get("/api/v1/admin/audit").status_code == 401


def test_get_settings_returns_values_defaults_and_restart_only_config(client):
    login(client)
    body = client.get("/api/v1/admin/settings").json()
    assert body["settings"]["whisper_model_name"] == "large-v3"
    assert body["defaults"]["beam_size"] == 5
    assert "turbo" in body["allowed_models"]
    assert "pt" in body["languages"]
    assert body["restart_only"]["device"] == "cpu"


def test_updating_settings_validates_saves_and_audits(client, repo):
    login(client)
    current = client.get("/api/v1/admin/settings").json()["settings"]

    assert client.put("/api/v1/admin/settings", json=current).status_code == 403  # no header

    bad_vad = {**current, "vad_onset": 0.2, "vad_offset": 0.3}
    assert client.put("/api/v1/admin/settings", json=bad_vad, headers=HEADERS).status_code == 422

    bad_model = {**current, "whisper_model_name": "someone/evil-model"}
    assert client.put("/api/v1/admin/settings", json=bad_model, headers=HEADERS).status_code == 422

    changed = {**current, "beam_size": 3, "default_language": "pt"}
    response = client.put("/api/v1/admin/settings", json=changed, headers=HEADERS)
    assert response.status_code == 200
    assert sorted(response.json()["changed"]) == ["beam_size", "default_language"]
    assert response.json()["settings"]["beam_size"] == 3
    assert repo.settings["default_language"] == "pt"

    audit = client.get("/api/v1/admin/audit").json()
    assert {(e["setting_key"], e["old_value"], e["new_value"]) for e in audit} == {
        ("beam_size", 5, 3),
        ("default_language", None, "pt"),
    }


def test_logout_ends_the_session(client):
    login(client)
    assert client.post("/api/v1/admin/logout", headers=HEADERS).status_code == 204
    assert client.get("/api/v1/admin/session").status_code == 401


def test_password_change_checks_the_current_password_and_policy(client, repo):
    login(client)
    other_device = make_client(repo)
    login(other_device)
    assert len(repo.sessions) == 2

    def change(current, new, headers=HEADERS):
        return client.post(
            "/api/v1/admin/password",
            json={"current_password": current, "new_password": new},
            headers=headers,
        )

    assert change(PASSWORD, "brand new password", headers={}).status_code == 403
    assert change("wrong current pw", "brand new password").status_code == 403
    assert change(PASSWORD, "short").status_code == 422
    assert change(PASSWORD, PASSWORD).status_code == 422

    assert change(PASSWORD, "brand new password").status_code == 204
    assert len(repo.sessions) == 1  # the other device was signed out
    assert client.get("/api/v1/admin/session").status_code == 200
    assert other_device.get("/api/v1/admin/session").status_code == 401

    fresh = make_client(repo)
    assert login(fresh).status_code == 401
    assert login(fresh, password="brand new password").status_code == 200
