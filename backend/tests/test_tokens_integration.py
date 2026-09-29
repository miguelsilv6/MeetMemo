"""
Tokens end to end against a real PostgreSQL database: one token per accepted
audio, charged atomically with the job, refunded when processing fails or an
audio is deleted before being processed, never spent on duplicates, never
overspent by concurrent uploads, and granted or taken by the administrator.
The ledger always adds up to the balance.

Skipped unless MEETMEMO_TEST_DATABASE_URL points at a disposable database, e.g.
    MEETMEMO_TEST_DATABASE_URL=postgresql://postgres@localhost:5432/meetmemo_test
The database is reset (all MeetMemo tables dropped) before the test runs.
"""
import asyncio
import importlib.util
import os
import uuid as uuid_lib
from contextlib import asynccontextmanager
from pathlib import Path
from types import SimpleNamespace

import pytest

TEST_DATABASE_URL = os.getenv("MEETMEMO_TEST_DATABASE_URL")
pytestmark = pytest.mark.skipif(
    not TEST_DATABASE_URL, reason="MEETMEMO_TEST_DATABASE_URL not set"
)

BACKEND = Path(__file__).resolve().parents[1]
MIGRATIONS = BACKEND / "migrations"
ADMIN_PASSWORD = "administrator password"
PASSWORD = "ana's own password"
HEADERS = {"X-MeetMemo-Request": "1"}
ADMIN_HEADERS = {"X-MeetMemo-Admin": "1"}


def _load(name):
    spec = importlib.util.spec_from_file_location(
        f"tokens_it_{name}", BACKEND / "api" / "v1" / f"{name}.py"
    )
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


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


def _settings(tmp_path):
    dirs = {}
    for name in ("upload", "transcript", "summary", "translation", "export"):
        dirs[f"{name}_dir"] = str(tmp_path / name)
        os.makedirs(dirs[f"{name}_dir"])
    dirs["transcript_edited_dir"] = str(tmp_path / "transcript" / "edited")
    os.makedirs(dirs["transcript_edited_dir"])
    return SimpleNamespace(
        **dirs,
        max_file_size=10 * 1024 * 1024,
        whisper_model_name="large-v3",
        job_retention_hours=12,
        admin_session_hours=8,
        user_session_hours=12,
    )


def test_tokens_against_real_postgres(monkeypatch, tmp_path):
    # pylint: disable=import-outside-toplevel,too-many-locals,too-many-statements
    from fastapi import FastAPI
    from fastapi.testclient import TestClient

    _reset_database()
    settings = _settings(tmp_path)
    monkeypatch.setenv("DATABASE_URL", TEST_DATABASE_URL)

    import database
    from admin_auth import hash_password
    from repositories.admin_repository import AdminRepository
    from repositories.job_repository import JobRepository
    from repositories.project_repository import ProjectRepository
    from repositories.user_repository import UserRepository
    from services.audio_service import AudioService
    from services.project_service import ProjectService

    routers = {name: _load(name) for name in ("auth", "admin", "projects")}

    @asynccontextmanager
    async def lifespan(_app):
        await database.init_database()
        await database.ensure_projects_schema()
        await database.ensure_users_schema()
        await database.ensure_tokens_schema()
        await database.ensure_tokens_schema()  # idempotent on an existing schema
        await database.require_owners()
        await database.ensure_admin_schema()
        await AdminRepository().create_credentials_if_missing(
            "admin", hash_password(ADMIN_PASSWORD)
        )
        yield
        await database.close_database()

    app = FastAPI(lifespan=lifespan)
    for module in routers.values():
        app.include_router(module.router, prefix="/api/v1")
        if hasattr(module, "get_settings"):
            app.dependency_overrides[module.get_settings] = lambda: settings
    app.dependency_overrides[routers["projects"].get_audio_service] = (
        lambda: AudioService(settings, JobRepository())
    )

    with TestClient(app) as client:

        def run(coro):
            async def call():
                return await coro

            return client.portal.call(call)

        def cookie_of(response, name):
            token = response.cookies.get(name)
            client.cookies.clear()
            assert token
            return {"Cookie": f"{name}={token}"}

        admin = cookie_of(client.post(
            "/api/v1/admin/login", json={"username": "admin", "password": ADMIN_PASSWORD},
            headers=ADMIN_HEADERS,
        ), "meetmemo_admin")
        admin_headers = {**admin, **ADMIN_HEADERS}

        # --- The administrator creates Ana with 2 tokens ------------------------
        created = client.post("/api/v1/admin/users", headers=admin_headers, json={
            "username": "ana", "display_name": "Ana", "password": "temporary password",
            "initial_tokens": 2,
        }).json()
        ana_uuid = str(created["uuid"])
        assert created["token_balance"] == 2
        run(UserRepository().set_password(ana_uuid, hash_password(PASSWORD), must_change=False))
        ana = cookie_of(client.post("/api/v1/auth/login", headers=HEADERS,
                                    json={"username": "ana", "password": PASSWORD}),
                        "meetmemo_session")
        ana_headers = {**ana, **HEADERS}

        def balance():
            return client.get("/api/v1/auth/me", headers=ana).json()["token_balance"]

        def ledger():
            return client.get(f"/api/v1/admin/users/{ana_uuid}/tokens", headers=admin).json()

        def ledger_adds_up():
            data = ledger()
            extra = [t for t in data["transactions"] if t["pool"] == "balance"]
            assert sum(t["delta"] for t in extra) == data["token_balance"]

        assert balance() == 2
        assert client.get("/api/v1/auth/me", headers=admin).json()["token_balance"] is None

        pid = client.post("/api/v1/projects", json={"name": "Caso"}, headers=ana_headers).json()["uuid"]

        def upload(name, content):
            response = client.post(
                f"/api/v1/projects/{pid}/audios", headers=ana_headers,
                files=[("files", (name, content, "audio/wav"))],
            )
            assert response.status_code == 200, response.text
            return response.json()["results"][0]

        # --- One token per accepted audio; duplicates are free ------------------
        first = upload("um.wav", b"RIFF-1")
        assert (first["status"], balance()) == ("queued", 1)
        assert upload("um de novo.wav", b"RIFF-1")["status"] == "duplicate"
        assert balance() == 1
        second = upload("dois.wav", b"RIFF-2")
        assert (second["status"], balance()) == ("queued", 0)

        # --- Without tokens nothing is stored ------------------------------------
        files_before = sorted(os.listdir(settings.upload_dir))
        assert upload("tres.wav", b"RIFF-3")["status"] == "no_tokens"
        assert sorted(os.listdir(settings.upload_dir)) == files_before
        assert len(client.get(f"/api/v1/projects/{pid}", headers=ana).json()["audios"]) == 2

        # --- A failure gives the token back, once --------------------------------
        run(database.update_workflow_state(first["uuid"], "error", 0))
        assert balance() == 1
        run(database.update_workflow_state(first["uuid"], "error", 0))  # already failed
        assert balance() == 1

        # Retrying charges again; without tokens the retry is refused.
        assert client.post(f"/api/v1/projects/{pid}/audios/{first['uuid']}/retry",
                           headers=ana_headers).status_code == 204
        assert balance() == 0
        run(database.update_workflow_state(first["uuid"], "error", 0))
        assert balance() == 1
        assert client.post(f"/api/v1/admin/users/{ana_uuid}/tokens", headers=admin_headers,
                           json={"delta": -1, "note": "correction"}).status_code == 200
        assert balance() == 0
        refused = client.post(f"/api/v1/projects/{pid}/audios/{first['uuid']}/retry",
                              headers=ana_headers)
        assert refused.status_code == 402
        assert run(database.get_job(first["uuid"]))["workflow_state"] == "error"

        # A crash the steps did not record (mid-step) still fails the audio and
        # gives the token back.
        client.post(f"/api/v1/admin/users/{ana_uuid}/tokens", headers=admin_headers,
                    json={"delta": 1})
        assert client.post(f"/api/v1/projects/{pid}/audios/{first['uuid']}/retry",
                           headers=ana_headers).status_code == 204
        run(database.update_workflow_state(first["uuid"], "transcribing", 40))
        assert balance() == 0
        run(ProjectRepository().mark_error(first["uuid"], "worker crashed"))
        assert run(database.get_job(first["uuid"]))["workflow_state"] == "error"
        assert balance() == 1
        # ...but never one that already finished.
        run(database.update_workflow_state(second["uuid"], "completed", 100))
        run(ProjectRepository().mark_error(second["uuid"], "late"))
        assert run(database.get_job(second["uuid"]))["workflow_state"] == "completed"
        client.post(f"/api/v1/admin/users/{ana_uuid}/tokens", headers=admin_headers,
                    json={"delta": -1})

        # --- The administrator gives and takes tokens ----------------------------
        too_many = client.post(f"/api/v1/admin/users/{ana_uuid}/tokens", headers=admin_headers,
                               json={"delta": -1})
        assert too_many.status_code == 409
        assert client.post(f"/api/v1/admin/users/{ana_uuid}/tokens", headers=admin_headers,
                           json={"delta": 0}).status_code == 422
        granted = client.post(f"/api/v1/admin/users/{ana_uuid}/tokens", headers=admin_headers,
                              json={"delta": 5, "note": "  top-up  "})
        assert granted.json() == {"token_balance": 5, "daily_quota": 0, "daily_used": 0}
        assert ledger()["transactions"][0]["note"] == "top-up"

        # --- Audios deleted before processing get their token back ---------------
        queued = upload("quatro.wav", b"RIFF-4")
        assert balance() == 4
        assert client.delete(f"/api/v1/projects/{pid}/audios/{queued['uuid']}",
                             headers=ana_headers).status_code == 204
        assert balance() == 5
        # ...but a processed audio's token is spent for good.
        run(database.update_workflow_state(second["uuid"], "completed", 100))
        client.delete(f"/api/v1/projects/{pid}/audios/{second['uuid']}", headers=ana_headers)
        assert balance() == 5

        # Deleting or expiring a project refunds its queued audios.
        upload("cinco.wav", b"RIFF-5")
        upload("seis.wav", b"RIFF-6")
        assert balance() == 3
        assert client.delete(f"/api/v1/projects/{pid}", headers=ana_headers).status_code == 204
        assert balance() == 5

        pid = client.post("/api/v1/projects", json={"name": "Expira"}, headers=ana_headers).json()["uuid"]
        upload("sete.wav", b"RIFF-7")
        assert balance() == 4

        async def expire():
            async with database.get_db() as conn:
                await conn.execute("UPDATE projects SET expires_at = NOW() - INTERVAL '1 second'")

        run(expire())
        assert run(ProjectService(settings, ProjectRepository()).delete_expired()) == 1
        assert balance() == 5

        # --- Single audios: charged with the job, refunded if never processed ----
        solo = str(uuid_lib.uuid4())
        run(database.add_job(solo, "solo.wav", 202, "h-solo", user_uuid=ana_uuid, charge=True))
        assert balance() == 4
        assert run(database.delete_job(solo)) == "solo.wav"
        assert balance() == 5

        # --- Concurrent uploads never overspend -----------------------------------
        client.post(f"/api/v1/admin/users/{ana_uuid}/tokens", headers=admin_headers,
                    json={"delta": -4})
        assert balance() == 1

        async def race():
            async def one(i):
                try:
                    await database.add_job(str(uuid_lib.uuid4()), f"r{i}.wav", 202, f"h{i}",
                                           user_uuid=ana_uuid, charge=True)
                    return "ok"
                except database.InsufficientTokensError:
                    return "refused"
            return sorted(await asyncio.gather(*(one(i) for i in range(5))))

        assert run(race()) == ["ok", "refused", "refused", "refused", "refused"]
        assert balance() == 0

        # --- The ledger always adds up to the balance -----------------------------
        ledger_adds_up()
        reasons = {t["reason"] for t in ledger()["transactions"]}
        assert reasons == {"grant", "revoke", "charge", "refund"}
        audit = client.get("/api/v1/admin/audit", headers=admin).json()
        assert "user_tokens" in {e["setting_key"] for e in audit}

        # Deleting the user takes their ledger with them.
        assert client.delete(f"/api/v1/admin/users/{ana_uuid}",
                             headers=admin_headers).status_code == 204

        async def ledger_rows():
            async with database.get_db() as conn:
                return await conn.fetchval("SELECT COUNT(*) FROM token_transactions")

        assert run(ledger_rows()) == 0
