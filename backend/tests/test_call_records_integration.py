"""
Call records against a real PostgreSQL database: the owner imports an
audio's TranslatedPRI.xml and reads its fields, the file comes back byte for
byte, a file that is not a call record is refused, replacing one keeps the
replaced file's hash in the history, another user sees nothing, and deleting
the audio deletes its record.

Skipped unless MEETMEMO_TEST_DATABASE_URL points at a disposable database (the
database is reset first; see test_tokens_integration).
"""
import uuid as uuid_lib
from contextlib import asynccontextmanager
from pathlib import Path

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

SAMPLE = (Path(__file__).parent / "fixtures" / "TranslatedPRI.xml").read_bytes()
GUID_NAME = "e153c371-f8fc-8b16-8a67-e7da3347b76d.wav"


def test_call_records_against_real_postgres(monkeypatch, tmp_path):
    # pylint: disable=import-outside-toplevel,too-many-locals,too-many-statements
    from fastapi import FastAPI
    from fastapi.testclient import TestClient

    _reset_database()
    settings = _settings(tmp_path)
    monkeypatch.setenv("DATABASE_URL", TEST_DATABASE_URL)

    import database
    from admin_auth import hash_password
    from repositories.admin_repository import AdminRepository
    from repositories.call_record_repository import CallRecordRepository
    from repositories.user_repository import UserRepository
    from services.user_service import UserService

    routers = {name: _load(name) for name in ("auth", "call_records", "projects")}

    @asynccontextmanager
    async def lifespan(_app):
        await database.init_database()
        await database.ensure_projects_schema()
        await database.ensure_users_schema()
        await database.ensure_tokens_schema("UTC")
        await database.ensure_tokens_schema("UTC")  # the table is idempotent too
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

        def sign_in(username, password):
            response = client.post("/api/v1/auth/login", headers=HEADERS,
                                   json={"username": username, "password": password})
            assert response.status_code == 200, response.text
            cookies = dict(response.cookies.items())
            client.cookies.clear()
            return {"Cookie": "; ".join(f"{k}={v}" for k, v in cookies.items()), **HEADERS}

        users = {}
        for name in ("ana", "rui"):
            created = run(UserService(settings).create(name, name.title(), PASSWORD))
            users[name] = str(created["uuid"])
            run(UserRepository().set_password(users[name], hash_password(PASSWORD),
                                              must_change=False))
        ana, rui = sign_in("ana", PASSWORD), sign_in("rui", PASSWORD)
        admin = sign_in("admin", ADMIN_PASSWORD)

        job = str(uuid_lib.uuid4())
        run(database.add_job(job, GUID_NAME, 200, f"h-{job}", user_uuid=users["ana"]))
        url = f"/api/v1/jobs/{job}/call-record"

        def upload(headers, content, name="TranslatedPRI.xml"):
            return client.put(url, headers=headers,
                              files={"file": (name, content, "application/xml")})

        # --- Nothing yet --------------------------------------------------------------
        assert client.get(url, headers=ana).status_code == 404

        # --- The owner imports it and reads its fields --------------------------------
        imported = upload(ana, SAMPLE, "C:\\Casos\\TranslatedPRI.xml")
        assert imported.status_code == 200, imported.text
        record = imported.json()
        assert record["source_name"] == "TranslatedPRI.xml"  # the name, not the path
        assert record["imported_by"] == "ana"
        assert record["guid_matches_audio"] is True
        assert record["history"] == []
        summary = record["data"]["summary"]
        assert (summary["caller"], summary["callee"], summary["duration_seconds"]) == (
            "351912052349", "+351915592482", 58)
        assert client.get(url, headers=ana).json() == record

        # --- The file comes back exactly as imported -----------------------------------
        file = client.get(f"{url}/file", headers=ana)
        assert file.status_code == 200
        assert file.content == SAMPLE
        assert file.headers["content-type"].startswith("application/xml")
        assert "TranslatedPRI.xml" in file.headers["content-disposition"]
        import hashlib
        assert hashlib.sha256(file.content).hexdigest() == record["sha256"]

        # --- The same file again changes nothing (no entry in the history) ---------------
        again = upload(ana, SAMPLE, "outra-copia.xml").json()
        assert again == record

        # --- What is not a call record is refused, and changes nothing ----------------
        bad = upload(ana, b"<Product/>")
        assert bad.status_code == 422 and "TranslatedPRI.xml" in bad.json()["detail"]
        assert upload(ana, b"<?xml version='1.0'?><!DOCTYPE x [<!ENTITY e 'x'>]>"
                           b"<Produto De='&e;'/>").status_code == 422
        assert client.get(url, headers=ana).json()["sha256"] == record["sha256"]
        # Without the application's request header (a cross-site form): refused.
        no_header = {k: v for k, v in ana.items() if k != "X-MeetMemo-Request"}
        assert client.put(url, headers=no_header,
                          files={"file": ("x.xml", SAMPLE)}).status_code == 403

        # --- Another user sees nothing; the administrator may replace it --------------
        assert client.get(url, headers=rui).status_code == 404
        assert upload(rui, SAMPLE).status_code == 404
        other = SAMPLE.replace(b'GUID="E153C371F8FC8B168A67E7DA3347B76D"', b'GUID="ABCDEF"')
        replaced = upload(admin, other).json()
        assert replaced["imported_by"] == "admin"
        assert replaced["guid_matches_audio"] is False  # not this audio's: the page warns
        [previous] = replaced["history"]
        assert (previous["sha256"], previous["imported_by"], previous["replaced_by"]) == (
            record["sha256"], "ana", "admin")
        assert run(CallRecordRepository().summaries([job]))[job]["guid"] == "ABCDEF"

        # --- The project's list of audios says who called whom -------------------------
        from repositories.project_repository import ProjectRepository
        project = run(ProjectRepository().create(
            str(uuid_lib.uuid4()), "Inquérito 3", None, None, 30, users["ana"]))
        in_project = str(uuid_lib.uuid4())
        run(database.add_job(in_project, "x.wav", 200, f"h-{in_project}",
                             user_uuid=users["ana"]))

        async def into_project():
            async with database.get_db() as conn:
                await conn.execute("UPDATE jobs SET project_uuid = $2 WHERE uuid = $1",
                                   in_project, project["uuid"])
        run(into_project())
        client.put(f"/api/v1/jobs/{in_project}/call-record", headers=ana,
                   files={"file": ("TranslatedPRI.xml", SAMPLE)})
        [listed] = client.get(f"/api/v1/projects/{project['uuid']}",
                              headers=ana).json()["audios"]
        assert listed["call"] == {"caller": "351912052349", "callee": "+351915592482",
                                  "start": "17-11-2026 20:31:50", "duration_seconds": 58}

        # --- Deleting the audio deletes its record ------------------------------------
        async def delete_job():
            async with database.get_db() as conn:
                await conn.execute("DELETE FROM jobs WHERE uuid = $1", job)
        run(delete_job())
        assert run(CallRecordRepository().get(job)) is None
