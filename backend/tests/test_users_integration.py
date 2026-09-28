"""
User accounts end to end against a real PostgreSQL database: the migration
that removes data from before accounts existed, sign-in, the forced password
change, isolation between users on every kind of route, the administrator's
view of everything, and deactivating and deleting an account.

Skipped unless MEETMEMO_TEST_DATABASE_URL points at a disposable database, e.g.
    MEETMEMO_TEST_DATABASE_URL=postgresql://postgres@localhost:5432/meetmemo_test
The database is reset (all MeetMemo tables dropped) before the test runs.
"""
import asyncio
import importlib.util
import json
import os
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
TEMPORARY = "temporary password 1"
ANA_PASSWORD = "ana's own password"
BRUNO_PASSWORD = "bruno's own password"
HEADERS = {"X-MeetMemo-Request": "1"}
ADMIN_HEADERS = {"X-MeetMemo-Admin": "1"}


def _load(name):
    spec = importlib.util.spec_from_file_location(f"users_it_{name}", BACKEND / "api" / "v1" / f"{name}.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _prepare_old_installation(settings):
    """A database and files from before user accounts: one audio, one project."""
    import asyncpg  # pylint: disable=import-outside-toplevel

    async def prepare():
        conn = await asyncpg.connect(TEST_DATABASE_URL)
        try:
            await conn.execute("DROP SCHEMA public CASCADE; CREATE SCHEMA public;")
            for name in ("001_init_schema.sql", "002_add_language_model_fields.sql",
                         "003_admin_panel.sql", "004_projects.sql"):
                await conn.execute((MIGRATIONS / name).read_text(encoding="utf-8"))
            await conn.execute(
                """INSERT INTO jobs (uuid, file_name, status_code, workflow_state)
                   VALUES ('aaaaaaaa-0000-0000-0000-000000000001', 'old.wav', 200, 'completed')"""
            )
            await conn.execute(
                """INSERT INTO projects (uuid, name, expires_at)
                   VALUES ('bbbbbbbb-0000-0000-0000-000000000001', 'Old', NOW() + INTERVAL '1 day')"""
            )
        finally:
            await conn.close()

    asyncio.run(prepare())
    old_files = [
        os.path.join(settings.upload_dir, "old.wav"),
        os.path.join(settings.transcript_dir, "old.json"),
        os.path.join(settings.summary_dir, "aaaaaaaa-0000-0000-0000-000000000001.txt"),
    ]
    for path in old_files:
        Path(path).write_text("x", encoding="utf-8")
    return old_files


def _settings(tmp_path):
    dirs = {}
    for name in ("upload", "transcript", "summary", "translation", "export"):
        dirs[f"{name}_dir"] = str(tmp_path / name)
        os.makedirs(dirs[f"{name}_dir"])
    dirs["transcript_edited_dir"] = str(tmp_path / "transcript" / "edited")
    os.makedirs(dirs["transcript_edited_dir"])
    settings = SimpleNamespace(
        **dirs,
        max_file_size=10 * 1024 * 1024,
        whisper_model_name="large-v3",
        job_retention_hours=12,
        admin_session_hours=8,
        user_session_hours=12,
    )
    settings.summary_path = Path(settings.summary_dir)
    settings.system_info = lambda: {
        "resolved_profile": "cpu", "device": "cpu", "compute_type": "int8",
        "pyannote_model_name": "pyannote/speaker-diarization-3.1",
    }
    return settings


def test_user_accounts_against_real_postgres(monkeypatch, tmp_path):
    # pylint: disable=import-outside-toplevel,too-many-locals,too-many-statements
    from fastapi import FastAPI
    from fastapi.testclient import TestClient

    settings = _settings(tmp_path)
    old_files = _prepare_old_installation(settings)
    monkeypatch.setenv("DATABASE_URL", TEST_DATABASE_URL)

    import database
    from admin_auth import hash_password
    from repositories.admin_repository import AdminRepository
    from repositories.job_repository import JobRepository
    from services.audio_service import AudioService
    from services.user_service import purge_ownerless

    routers = {name: _load(name) for name in ("auth", "admin", "projects", "transcripts", "audio")}

    @asynccontextmanager
    async def lifespan(_app):
        await database.init_database()
        await database.ensure_projects_schema()
        await database.ensure_users_schema()
        assert await purge_ownerless(settings) == 1
        await database.ensure_users_schema()  # idempotent once owners are required
        assert await purge_ownerless(settings) == 0
        await database.ensure_admin_schema()
        await AdminRepository().create_credentials_if_missing(
            "admin", hash_password(ADMIN_PASSWORD)
        )
        yield
        await database.close_database()

    app = FastAPI(lifespan=lifespan)
    for module in routers.values():
        app.include_router(module.router, prefix="/api/v1")
    for module in routers.values():
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

        # --- The migration removed the data from before accounts ---------------
        assert not any(os.path.exists(p) for p in old_files)

        async def counts():
            async with database.get_db() as conn:
                return (await conn.fetchval("SELECT COUNT(*) FROM jobs"),
                        await conn.fetchval("SELECT COUNT(*) FROM projects"))

        assert run(counts()) == (0, 0)

        # --- Without a session nothing is reachable -----------------------------
        assert client.get("/api/v1/projects").status_code == 401
        assert client.get("/api/v1/auth/me").status_code == 401

        # --- The administrator creates two accounts -----------------------------
        admin = cookie_of(client.post(
            "/api/v1/admin/login", json={"username": "admin", "password": ADMIN_PASSWORD},
            headers=ADMIN_HEADERS,
        ), "meetmemo_admin")
        admin_headers = {**admin, **ADMIN_HEADERS}
        for username, name in (("ana", "Ana Silva"), ("bruno", "Bruno Costa")):
            created = client.post(
                "/api/v1/admin/users",
                json={"username": username, "display_name": name, "password": TEMPORARY},
                headers=admin_headers,
            )
            assert created.status_code == 201, created.text
            assert created.json()["must_change_password"] is True
        taken = client.post(
            "/api/v1/admin/users",
            json={"username": "ANA", "display_name": "x", "password": TEMPORARY},
            headers=admin_headers,
        )
        assert taken.status_code == 409
        weak = client.post(
            "/api/v1/admin/users",
            json={"username": "carla", "display_name": "x", "password": "short"},
            headers=admin_headers,
        )
        assert weak.status_code == 422
        users = {u["username"]: u for u in client.get("/api/v1/admin/users", headers=admin).json()}
        assert set(users) == {"ana", "bruno"}

        # --- Sign-in, forced password change ------------------------------------
        def login(username, password):
            return client.post(
                "/api/v1/auth/login", json={"username": username, "password": password},
                headers=HEADERS,
            )

        assert login("ana", "wrong password").status_code == 401
        assert login("nobody", "wrong password").json() == login("ana", "nope").json()
        response = login("ANA", TEMPORARY)  # usernames ignore case
        assert response.status_code == 200
        assert response.json()["must_change_password"] is True
        set_cookie = response.headers["set-cookie"].lower()
        assert "httponly" in set_cookie and "samesite=strict" in set_cookie
        assert "path=/api/v1" in set_cookie
        ana = cookie_of(response, "meetmemo_session")
        ana_headers = {**ana, **HEADERS}

        blocked = client.get("/api/v1/projects", headers=ana)
        assert (blocked.status_code, blocked.json()["detail"]) == (
            403, "Password change required"
        )
        assert client.post("/api/v1/auth/password", headers=ana, json={
            "current_password": TEMPORARY, "new_password": ANA_PASSWORD,
        }).status_code == 403  # no request header
        assert client.post("/api/v1/auth/password", headers=ana_headers, json={
            "current_password": TEMPORARY, "new_password": ANA_PASSWORD,
        }).status_code == 204
        me = client.get("/api/v1/auth/me", headers=ana).json()
        assert me == {"username": "ana", "display_name": "Ana Silva", "is_admin": False,
                      "must_change_password": False}

        bruno_login = login("bruno", TEMPORARY)
        bruno = cookie_of(bruno_login, "meetmemo_session")
        bruno_headers = {**bruno, **HEADERS}
        client.post("/api/v1/auth/password", headers=bruno_headers, json={
            "current_password": TEMPORARY, "new_password": BRUNO_PASSWORD,
        })

        # --- Ana's project, audio and transcript --------------------------------
        project = client.post(
            "/api/v1/projects", json={"name": "Caso da Ana"}, headers=ana_headers
        ).json()
        pid = project["uuid"]
        results = client.post(
            f"/api/v1/projects/{pid}/audios", headers=ana_headers,
            files=[("files", ("chamada.wav", b"RIFF-ana", "audio/wav"))],
        ).json()["results"]
        job_uuid = results[0]["uuid"]
        job = run(database.get_job(job_uuid))
        base = os.path.splitext(job["file_name"])[0]
        Path(settings.transcript_dir, f"{base}.json").write_text(
            json.dumps([{"speaker": "SPEAKER_00", "text": "Olá", "start": "0.00", "end": "1.00"}]),
            encoding="utf-8",
        )

        # Ana sees her things.
        assert [p["uuid"] for p in client.get("/api/v1/projects", headers=ana).json()["projects"]] == [pid]
        assert client.get(f"/api/v1/jobs/{job_uuid}/transcripts", headers=ana).status_code == 200
        assert client.get(f"/api/v1/jobs/{job_uuid}/audio", headers=ana).status_code in (200, 206)

        # --- Bruno sees nothing of Ana's, not even that it exists ---------------
        assert client.get("/api/v1/projects", headers=bruno).json()["projects"] == []
        for method, url in (
            ("get", f"/api/v1/projects/{pid}"),
            ("patch", f"/api/v1/projects/{pid}"),
            ("delete", f"/api/v1/projects/{pid}"),
            ("post", f"/api/v1/projects/{pid}/audios"),
            ("delete", f"/api/v1/projects/{pid}/audios/{job_uuid}"),
            ("get", f"/api/v1/jobs/{job_uuid}/transcripts"),
            ("patch", f"/api/v1/jobs/{job_uuid}/transcripts"),
            ("post", f"/api/v1/jobs/{job_uuid}/transcripts/translate"),
            ("get", f"/api/v1/jobs/{job_uuid}/audio"),
            ("get", f"/api/v1/jobs/{job_uuid}/waveform?start=0&end=1"),
        ):
            response = getattr(client, method)(url, headers=bruno_headers)
            assert response.status_code == 404, (method, url, response.status_code)
        assert os.path.exists(os.path.join(settings.upload_dir, job["file_name"]))

        # Bruno cannot upload into Ana's project either, and the administrator
        # (who has no account) cannot upload at all.
        assert client.post("/api/v1/projects", json={"name": "x"},
                           headers=admin_headers).status_code == 403

        # --- The administrator sees everything ----------------------------------
        listing = client.get("/api/v1/projects", headers=admin).json()["projects"]
        assert [(p["uuid"], p["owner"]) for p in listing] == [(pid, "ana")]
        assert client.get(f"/api/v1/projects/{pid}", headers=admin).status_code == 200
        assert client.get(f"/api/v1/jobs/{job_uuid}/transcripts", headers=admin).status_code == 200
        content = client.get(f"/api/v1/admin/users/{users['ana']['uuid']}/content",
                             headers=admin).json()
        assert [p["uuid"] for p in content["projects"]] == [pid]
        counts_by_user = {u["username"]: (u["project_count"], u["audio_count"])
                          for u in client.get("/api/v1/admin/users", headers=admin).json()}
        assert counts_by_user == {"ana": (1, 1), "bruno": (0, 0)}

        # --- Deactivation signs the user out; reactivation lets them back -------
        ana_uuid = str(users["ana"]["uuid"])
        assert client.patch(f"/api/v1/admin/users/{ana_uuid}", json={"is_active": False},
                            headers=admin_headers).status_code == 200
        assert client.get("/api/v1/projects", headers=ana).status_code == 401
        assert login("ana", ANA_PASSWORD).status_code == 401
        client.patch(f"/api/v1/admin/users/{ana_uuid}", json={"is_active": True},
                     headers=admin_headers)
        ana = cookie_of(login("ana", ANA_PASSWORD), "meetmemo_session")

        # A password reset forces a new change and ends existing sessions.
        assert client.post(f"/api/v1/admin/users/{ana_uuid}/password",
                           json={"password": TEMPORARY}, headers=admin_headers).status_code == 204
        assert client.get("/api/v1/projects", headers=ana).status_code == 401
        assert login("ana", TEMPORARY).json()["must_change_password"] is True
        client.cookies.clear()

        # --- Deleting Ana removes her account, projects, audios and files -------
        assert client.delete(f"/api/v1/admin/users/{ana_uuid}",
                             headers=admin_headers).status_code == 204
        assert not os.path.exists(os.path.join(settings.upload_dir, job["file_name"]))
        assert not os.path.exists(os.path.join(settings.transcript_dir, f"{base}.json"))
        assert run(counts()) == (0, 0)
        assert [u["username"] for u in client.get("/api/v1/admin/users", headers=admin).json()] == [
            "bruno"
        ]

        audit_keys = [e["setting_key"] for e in client.get("/api/v1/admin/audit", headers=admin).json()]
        for key in ("user_created", "user_deactivated", "user_activated", "user_password_reset",
                    "user_deleted"):
            assert key in audit_keys

        # --- Logout ends the session ---------------------------------------------
        assert client.post("/api/v1/auth/logout", headers=bruno_headers).status_code == 204
        assert client.get("/api/v1/auth/me", headers=bruno).status_code == 401
