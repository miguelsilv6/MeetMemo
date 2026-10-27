"""
The administrator extending when an audio or a project is deleted, against a
real PostgreSQL database: an audio outside a project is deleted
`job_retention_hours` after upload unless the administrator gave it a later
date (an audio in a project lives until its project expires); only the
administrator may extend, only to a later date within a year; the cleanup
keeps an extended audio; every extension is in the audit trail.

Skipped unless MEETMEMO_TEST_DATABASE_URL points at a disposable database (the
database is reset first; see test_tokens_integration).
"""
import sys
import types
import uuid as uuid_lib
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone

import pytest

from tests.test_tokens_integration import (
    ADMIN_PASSWORD,
    HEADERS,
    PASSWORD,
    TEST_DATABASE_URL,
    _load,
    _reset_database,
    _settings,
)

pytestmark = pytest.mark.skipif(
    not TEST_DATABASE_URL, reason="MEETMEMO_TEST_DATABASE_URL not set"
)

ADMIN_HEADER = {"X-MeetMemo-Admin": "1"}


def test_extending_expiry_against_real_postgres(monkeypatch, tmp_path):
    # pylint: disable=import-outside-toplevel,too-many-locals,too-many-statements
    from fastapi import FastAPI
    from fastapi.testclient import TestClient

    _reset_database()
    settings = _settings(tmp_path)
    monkeypatch.setenv("DATABASE_URL", TEST_DATABASE_URL)

    import database
    from admin_auth import hash_password
    from repositories.admin_repository import AdminRepository
    from repositories.project_repository import ProjectRepository
    from repositories.user_repository import UserRepository
    from services.user_service import UserService

    # The jobs router imports the ML step services; the status does not use them.
    for name, cls in (("services.transcription_service", "TranscriptionService"),
                      ("services.diarization_service", "DiarizationService")):
        stub = types.ModuleType(name)
        setattr(stub, cls, type(cls, (), {}))
        monkeypatch.setitem(sys.modules, name, stub)
    routers = {name: _load(name) for name in ("auth", "jobs", "admin")}

    @asynccontextmanager
    async def lifespan(_app):
        await database.init_database()
        await database.ensure_projects_schema()
        await database.ensure_users_schema()
        await database.ensure_tokens_schema("UTC")
        await database.ensure_tokens_schema("UTC")  # the expiry column is idempotent too
        await database.ensure_llm_tasks_schema()
        await database.ensure_cue_points_schema()
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

    with TestClient(app) as client:

        def run(coro):
            async def call():
                return await coro

            return client.portal.call(call)

        async def sql(query, *args):
            async with database.get_db() as conn:
                return await conn.fetchval(query, *args)

        def sign_in(username, password):
            response = client.post("/api/v1/auth/login", headers=HEADERS,
                                   json={"username": username, "password": password})
            assert response.status_code == 200, response.text
            cookies = dict(response.cookies.items())
            client.cookies.clear()
            return {"Cookie": "; ".join(f"{k}={v}" for k, v in cookies.items()), **HEADERS}

        created = run(UserService(settings).create("ana", "Ana", PASSWORD))
        ana_uuid = str(created["uuid"])
        run(UserRepository().set_password(ana_uuid, hash_password(PASSWORD), must_change=False))
        ana = sign_in("ana", PASSWORD)
        admin = {**sign_in("admin", ADMIN_PASSWORD), **ADMIN_HEADER}

        def new_job(file_name, project_uuid=None):
            job = str(uuid_lib.uuid4())
            run(database.add_job(job, file_name, 200, f"h-{job}", user_uuid=ana_uuid))
            if project_uuid:
                run(sql("UPDATE jobs SET project_uuid = $2 WHERE uuid = $1", job, project_uuid))
            return job

        def when(value):
            return datetime.fromisoformat(value.replace("Z", "+00:00"))

        now = datetime.now(timezone.utc)
        single = new_job("single.wav")
        project = run(ProjectRepository().create(
            str(uuid_lib.uuid4()), "Inquérito 12", None, None, 30, ana_uuid
        ))
        project_uuid = str(project["uuid"])
        in_project = new_job("in-project.wav", project_uuid)

        # --- The owner sees when an audio outside a project is deleted ----------
        created_at = run(sql("SELECT created_at FROM jobs WHERE uuid = $1", single))
        status = client.get(f"/api/v1/jobs/{single}", headers=ana).json()
        assert when(status["expires_at"]) == created_at + timedelta(hours=12)
        assert client.get(f"/api/v1/jobs/{in_project}", headers=ana).json()["expires_at"] is None

        # --- Only the administrator extends, to a later date within a year -----
        url = f"/api/v1/admin/jobs/{single}/expiry"
        later = (now + timedelta(days=3)).isoformat()
        ana_as_admin = {**ana, **ADMIN_HEADER}
        assert client.put(url, json={"expires_at": later},
                          headers=ana_as_admin).status_code == 401
        no_header = {k: v for k, v in admin.items() if k != "X-MeetMemo-Admin"}
        assert client.put(url, json={"expires_at": later}, headers=no_header).status_code == 403
        for bad in ((now + timedelta(hours=1)).isoformat(),  # before its 12 h
                    (now + timedelta(days=366)).isoformat(),
                    "2030-01-01T10:00:00"):  # no time zone
            assert client.put(url, json={"expires_at": bad}, headers=admin).status_code == 422
        refused = client.put(f"/api/v1/admin/jobs/{in_project}/expiry",
                             json={"expires_at": later}, headers=admin)
        assert refused.status_code == 409
        missing = client.put(f"/api/v1/admin/jobs/{uuid_lib.uuid4()}/expiry",
                             json={"expires_at": later}, headers=admin)
        assert missing.status_code == 404

        extended = client.put(url, json={"expires_at": later}, headers=admin)
        assert extended.status_code == 200, extended.text
        assert when(extended.json()["expires_at"]) == when(later)
        assert when(client.get(f"/api/v1/jobs/{single}", headers=ana).json()["expires_at"]) == (
            when(later)
        )
        content = client.get(f"/api/v1/admin/users/{ana_uuid}/content", headers=admin).json()
        assert [(a["uuid"], when(a["expires_at"])) for a in content["audios"]] == [
            (single, when(later))
        ]
        assert when(content["projects"][0]["expires_at"]) == project["expires_at"]

        # --- The cleanup keeps an extended audio until its own date --------------
        other = new_job("other.wav")
        run(sql("UPDATE jobs SET created_at = NOW() - INTERVAL '2 days' "
                "WHERE uuid = ANY($1::uuid[])", [single, other]))
        deleted = run(database.cleanup_old_jobs(12))
        assert [str(job["uuid"]) for job in deleted] == [other]
        run(sql("UPDATE jobs SET expires_at = NOW() - INTERVAL '1 minute' WHERE uuid = $1",
                single))
        assert [str(job["uuid"]) for job in run(database.cleanup_old_jobs(12))] == [single]
        assert run(sql("SELECT COUNT(*) FROM jobs WHERE uuid = $1", in_project)) == 1

        # --- A project too ---------------------------------------------------------
        project_url = f"/api/v1/admin/projects/{project_uuid}/expiry"
        earlier = (project["expires_at"] - timedelta(days=1)).isoformat()
        assert client.put(project_url, json={"expires_at": earlier},
                          headers=admin).status_code == 422
        new_date = (now + timedelta(days=60)).isoformat()
        assert client.put(project_url, json={"expires_at": new_date},
                          headers=ana_as_admin).status_code == 401
        moved = client.put(project_url, json={"expires_at": new_date}, headers=admin)
        assert moved.status_code == 200, moved.text
        assert run(sql("SELECT expires_at FROM projects WHERE uuid = $1",
                       project_uuid)) == when(new_date)
        gone = client.put(f"/api/v1/admin/projects/{uuid_lib.uuid4()}/expiry",
                          json={"expires_at": new_date}, headers=admin)
        assert gone.status_code == 404

        # --- Both extensions are in the audit trail ------------------------------
        audit = run(AdminRepository().list_audit())
        entries = {entry["setting_key"]: entry for entry in audit}
        assert entries["expiry_job"]["actor"] == "admin"
        assert entries["expiry_job"]["new_value"].startswith("single.wav: ")
        assert entries["expiry_project"]["new_value"].startswith("Inquérito 12: ")
