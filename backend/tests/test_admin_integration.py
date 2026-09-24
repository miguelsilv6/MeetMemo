"""
End-to-end admin-panel test against a real PostgreSQL database.

Skipped unless MEETMEMO_TEST_DATABASE_URL points at a disposable database, e.g.
    MEETMEMO_TEST_DATABASE_URL=postgresql://postgres@localhost:5432/meetmemo_test
The database is reset (all MeetMemo tables dropped) before the test runs.
"""
import asyncio
import importlib.util
import os
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

TEST_DATABASE_URL = os.getenv("MEETMEMO_TEST_DATABASE_URL")
pytestmark = pytest.mark.skipif(
    not TEST_DATABASE_URL, reason="MEETMEMO_TEST_DATABASE_URL not set"
)

MIGRATIONS = Path(__file__).resolve().parents[1] / "migrations"
PASSWORD = "integration test password"
HEADERS = {"X-MeetMemo-Admin": "1"}


def _reset_database():
    import asyncpg  # pylint: disable=import-outside-toplevel

    async def reset():
        conn = await asyncpg.connect(TEST_DATABASE_URL)
        try:
            await conn.execute("DROP SCHEMA public CASCADE; CREATE SCHEMA public;")
            for name in ("001_init_schema.sql", "002_add_language_model_fields.sql"):
                await conn.execute((MIGRATIONS / name).read_text(encoding="utf-8"))
        finally:
            await conn.close()

    asyncio.run(reset())


def test_admin_panel_against_real_postgres(monkeypatch):
    # pylint: disable=import-outside-toplevel,too-many-locals,too-many-statements
    from fastapi import FastAPI
    from fastapi.testclient import TestClient

    _reset_database()
    monkeypatch.setenv("DATABASE_URL", TEST_DATABASE_URL)

    import database
    from admin_auth import hash_password
    from repositories.admin_repository import AdminRepository

    spec = importlib.util.spec_from_file_location(
        "admin_api_integration", Path(__file__).resolve().parents[1] / "api" / "v1" / "admin.py"
    )
    admin_api = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(admin_api)

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

    @asynccontextmanager
    async def lifespan(_app):
        await database.init_database()
        await database.ensure_admin_schema()
        await database.ensure_admin_schema()  # idempotent on an existing schema
        repo = AdminRepository()
        assert await repo.get_credentials() is None
        assert await repo.create_credentials_if_missing("admin", hash_password(PASSWORD))
        assert not await repo.create_credentials_if_missing("admin", hash_password("other"))

        expired = datetime.now(timezone.utc) - timedelta(minutes=1)
        await repo.create_session("expired-hash", "admin", expired)
        assert await repo.get_session("expired-hash") is None
        await repo.purge_expired_sessions()
        async with database.get_db() as conn:
            assert await conn.fetchval("SELECT COUNT(*) FROM admin_sessions") == 0
        yield
        await database.close_database()

    app = FastAPI(lifespan=lifespan)
    app.include_router(admin_api.router, prefix="/api/v1")
    app.dependency_overrides[admin_api.get_settings] = StubSettings

    with TestClient(app) as client:
        assert client.get("/api/v1/admin/status").json() == {"configured": True}

        wrong = client.post(
            "/api/v1/admin/login", json={"username": "admin", "password": "nope"}, headers=HEADERS
        )
        assert wrong.status_code == 401

        ok = client.post(
            "/api/v1/admin/login", json={"username": "admin", "password": PASSWORD}, headers=HEADERS
        )
        assert ok.status_code == 200
        assert client.get("/api/v1/admin/session").json() == {"username": "admin"}

        body = client.get("/api/v1/admin/settings").json()
        assert body["settings"]["whisper_model_name"] == "large-v3"

        updated = {
            **body["settings"],
            "whisper_model_name": "turbo",
            "default_language": "pt",
            "hallucination_phrases": ["Frase um", "Frase dois"],
        }
        saved = client.put("/api/v1/admin/settings", json=updated, headers=HEADERS)
        assert saved.status_code == 200
        assert sorted(saved.json()["changed"]) == [
            "default_language",
            "hallucination_phrases",
            "whisper_model_name",
        ]
        # Round-trips through JSONB unchanged.
        assert client.get("/api/v1/admin/settings").json()["settings"] == saved.json()["settings"]

        audit = client.get("/api/v1/admin/audit").json()
        by_key = {entry["setting_key"]: entry for entry in audit}
        assert by_key["whisper_model_name"]["old_value"] == "large-v3"
        assert by_key["whisper_model_name"]["new_value"] == "turbo"
        assert by_key["hallucination_phrases"]["new_value"] == ["Frase um", "Frase dois"]
        assert by_key["default_language"]["old_value"] is None
        assert all(entry["actor"] == "admin" for entry in audit)

        changed_pw = client.post(
            "/api/v1/admin/password",
            json={"current_password": PASSWORD, "new_password": "a brand new password"},
            headers=HEADERS,
        )
        assert changed_pw.status_code == 204
        assert client.get("/api/v1/admin/audit").json()[0]["setting_key"] == "admin_password"

        assert client.post("/api/v1/admin/logout", headers=HEADERS).status_code == 204
        assert client.get("/api/v1/admin/session").status_code == 401

        relogin = client.post(
            "/api/v1/admin/login",
            json={"username": "admin", "password": "a brand new password"},
            headers=HEADERS,
        )
        assert relogin.status_code == 200
