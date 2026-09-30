"""
Transcribing an audio again in a chosen language, against a real PostgreSQL
database: only a completed audio of the caller's own starts over, with the
language forced; what was made from the old transcript (transcript and its
edits, summary, translations, exports, summary/translation tasks) is deleted
while the audio itself stays; no token is charged, and the first one is no
longer refundable (neither if the new transcription fails nor if the audio is
deleted while it waits); a project audio goes back to the project queue.

Skipped unless MEETMEMO_TEST_DATABASE_URL points at a disposable database, e.g.
    MEETMEMO_TEST_DATABASE_URL=postgresql://postgres@localhost:5432/meetmemo_test
The database is reset (all MeetMemo tables dropped) before the test runs.
"""
import sys
import types
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


class _Queue:
    def __init__(self):
        self.notified = 0

    def notify(self):
        self.notified += 1


def test_retranscription_against_real_postgres(monkeypatch, tmp_path):
    # pylint: disable=import-outside-toplevel,too-many-locals,too-many-statements
    from fastapi import FastAPI
    from fastapi.testclient import TestClient

    _reset_database()
    settings = _settings(tmp_path)
    monkeypatch.setenv("DATABASE_URL", TEST_DATABASE_URL)

    import database
    from admin_auth import hash_password
    from repositories.admin_repository import AdminRepository
    from repositories.llm_task_repository import LlmTaskRepository
    from repositories.project_repository import ProjectRepository
    from repositories.token_repository import TokenRepository
    from repositories.user_repository import UserRepository
    from services.user_service import UserService

    # The jobs router imports the ML step services (torch, faster-whisper),
    # which the test dependencies leave out; re-transcribing does not use them.
    for name, cls in (("services.transcription_service", "TranscriptionService"),
                      ("services.diarization_service", "DiarizationService")):
        stub = types.ModuleType(name)
        setattr(stub, cls, type(cls, (), {}))
        monkeypatch.setitem(sys.modules, name, stub)
    routers = {name: _load(name) for name in ("auth", "jobs")}
    queue = _Queue()

    @asynccontextmanager
    async def lifespan(app):
        await database.init_database()
        await database.ensure_projects_schema()
        await database.ensure_users_schema()
        await database.ensure_tokens_schema("UTC")
        await database.ensure_tokens_schema("UTC")  # idempotent
        await database.ensure_llm_tasks_schema()
        await database.require_owners()
        await database.ensure_admin_schema()
        await AdminRepository().create_credentials_if_missing(
            "admin", hash_password(ADMIN_PASSWORD)
        )
        app.state.project_queue = queue
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

        def sign_in(username):
            response = client.post("/api/v1/auth/login", headers=HEADERS,
                                   json={"username": username, "password": PASSWORD})
            assert response.status_code == 200, response.text
            token = response.cookies.get("meetmemo_session")
            client.cookies.clear()
            return {"Cookie": f"meetmemo_session={token}", **HEADERS}

        users = {}
        for name in ("ana", "bruno"):
            created = run(UserService(settings).create(name, name.title(), PASSWORD))
            run(UserRepository().set_password(str(created["uuid"]), hash_password(PASSWORD),
                                              must_change=False))
            users[name] = str(created["uuid"])
        run(TokenRepository().adjust(users["ana"], 3, "admin", None))
        ana, bruno = sign_in("ana"), sign_in("bruno")

        def balance():
            return client.get("/api/v1/auth/me", headers=ana).json()["token_balance"]

        def new_job(file_name, project_uuid=None):
            job = str(uuid_lib.uuid4())
            run(database.add_job(job, file_name, 202, f"h-{job}", user_uuid=users["ana"],
                                 charge=True))
            if project_uuid:
                run(sql("UPDATE jobs SET project_uuid = $2 WHERE uuid = $1", job, project_uuid))
            run(database.update_workflow_state(job, "completed", 100))
            run(sql("UPDATE jobs SET status_code = 200, transcription_data = "
                    """'{"language": "en", "language_probability": 0.41}'::jsonb """
                    "WHERE uuid = $1", job))
            base = Path(file_name).stem
            made = {
                "audio": Path(settings.upload_dir, file_name),
                "transcript": Path(settings.transcript_dir, f"{base}.json"),
                "edited": Path(settings.transcript_edited_dir, f"{base}.json"),
                "summary": Path(settings.summary_dir, f"{job}.txt"),
                "translation": Path(settings.translation_dir, f"{base}.pt-PT.json"),
                "nllb": Path(settings.translation_dir, f"{base}.pt-PT.nllb.json"),
                "export": Path(settings.export_dir, f"{job}.md"),
            }
            for path in made.values():
                path.write_text("x", encoding="utf-8")
            run(sql("""INSERT INTO export_jobs (uuid, job_uuid, export_type, status_code,
                                                file_path)
                       VALUES ($1, $2, 'markdown', 200, $3) RETURNING uuid""",
                    uuid_lib.uuid4(), job, str(made["export"])))
            run(LlmTaskRepository().enqueue(job, "summary", None, "ana"))
            return job, made

        job, made = new_job("call.wav")
        assert balance() == 2
        url = f"/api/v1/jobs/{job}/retranscribe"

        # --- Refused: bad language, someone else's audio, no request header -----
        assert client.post(url, headers=ana, json={"language": "xx"}).status_code == 400
        assert client.post(url, headers=ana, json={"language": "auto"}).status_code == 400
        assert client.post(url, headers=ana, json={}).status_code == 422
        assert client.post(url, headers=bruno, json={"language": "pt"}).status_code == 404
        no_header = {"Cookie": ana["Cookie"]}
        assert client.post(url, headers=no_header, json={"language": "pt"}).status_code == 403

        # --- Starting over ------------------------------------------------------
        response = client.post(url, headers=ana, json={"language": "pt"})
        assert response.status_code == 202, response.text
        assert response.json()["workflow_state"] == "uploaded"
        state = client.get(f"/api/v1/jobs/{job}", headers=ana).json()
        assert (state["workflow_state"], state["error_message"]) == ("uploaded", None)
        assert run(sql("SELECT language FROM jobs WHERE uuid = $1", job)) == "pt"
        assert run(sql("SELECT transcription_data FROM jobs WHERE uuid = $1", job)) is None
        assert run(sql("SELECT COUNT(*) FROM export_jobs WHERE job_uuid = $1", job)) == 0
        assert run(sql("SELECT COUNT(*) FROM llm_tasks WHERE job_uuid = $1", job)) == 0
        assert made["audio"].exists()
        assert [name for name, path in made.items() if path.exists()] == ["audio"]
        assert balance() == 2  # free
        assert queue.notified == 0  # a single audio: the page drives it

        # Not while it is being processed.
        run(database.update_workflow_state(job, "transcribing", 10))
        assert client.post(url, headers=ana, json={"language": "en"}).status_code == 409

        # --- The first token is not given back ----------------------------------
        run(database.update_workflow_state(job, "error", 0))
        assert balance() == 2
        waiting, _ = new_job("waiting.wav")
        assert balance() == 1
        client.post(f"/api/v1/jobs/{waiting}/retranscribe", headers=ana, json={"language": "fr"})
        assert client.delete(f"/api/v1/jobs/{waiting}", headers=ana).status_code == 200
        assert balance() == 1
        # An audio that is only uploaded (never re-transcribed) still gets it back.
        fresh = str(uuid_lib.uuid4())
        run(database.add_job(fresh, "fresh.wav", 202, "h-fresh", user_uuid=users["ana"],
                             charge=True))
        assert balance() == 0
        client.delete(f"/api/v1/jobs/{fresh}", headers=ana)
        assert balance() == 1

        # --- A project audio goes back to the project queue ---------------------
        project = run(ProjectRepository().create(
            str(uuid_lib.uuid4()), "Caso", None, None, 7, users["ana"]))
        in_project, _ = new_job("p.wav", str(project["uuid"]))
        response = client.post(f"/api/v1/jobs/{in_project}/retranscribe", headers=ana,
                               json={"language": "es"})
        assert response.status_code == 202
        assert queue.notified == 1
        queued = run(ProjectRepository().next_queued_job())
        assert str(queued["uuid"]) == in_project
        # Failing does not give its token back; retried, it pays again, and that
        # new token is refundable.
        run(database.update_workflow_state(in_project, "error", 0))
        assert balance() == 0
        run(TokenRepository().adjust(users["ana"], 1, "admin", None))
        before = balance()
        assert run(ProjectRepository().retry_job(str(project["uuid"]), in_project))
        assert balance() == before - 1
        run(database.update_workflow_state(in_project, "error", 0))
        assert balance() == before
