"""
The administrator processing an audio again from the very start, against a
real PostgreSQL database: only the administrator may; only a completed audio
starts over; its language and model are cleared (the admin panel's apply),
what was made from the old transcript and the audio's ASR copies are deleted,
while the audio itself, its cue points and the number of speakers given at
upload stay; no token is charged; a project audio goes back to the queue.

Skipped unless MEETMEMO_TEST_DATABASE_URL points at a disposable database (the
database is reset first; see test_tokens_integration).
"""
import json
import sys
import types
import uuid as uuid_lib
from contextlib import asynccontextmanager
from pathlib import Path

import pytest

from tests.test_retranscription_integration import _Queue
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


def test_reprocessing_against_real_postgres(monkeypatch, tmp_path):
    # pylint: disable=import-outside-toplevel,too-many-locals,too-many-statements
    from fastapi import FastAPI
    from fastapi.testclient import TestClient

    _reset_database()
    settings = _settings(tmp_path)
    monkeypatch.setenv("DATABASE_URL", TEST_DATABASE_URL)

    import database
    from admin_auth import hash_password
    from repositories.admin_repository import AdminRepository
    from repositories.cue_point_repository import CuePointRepository
    from repositories.project_repository import ProjectRepository
    from repositories.token_repository import TokenRepository
    from repositories.user_repository import UserRepository
    from services.user_service import UserService
    from utils.asr_audio import asr_audio_path, channel_analysis_path, channel_asr_path

    # The jobs router imports the ML step services, left out of the test
    # dependencies; starting over does not use them.
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
        await database.ensure_llm_tasks_schema()
        await database.ensure_cue_points_schema()
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
        run(TokenRepository().adjust(ana_uuid, 3, "admin", None))
        ana = sign_in("ana", PASSWORD)
        admin = sign_in("admin", ADMIN_PASSWORD)

        def balance():
            return client.get("/api/v1/auth/me", headers=ana).json()["token_balance"]

        def new_job(file_name, project_uuid=None):
            job = str(uuid_lib.uuid4())
            run(database.add_job(job, file_name, 202, f"h-{job}", model_name="turbo",
                                 language="en", user_uuid=ana_uuid, charge=True,
                                 num_speakers=3))
            if project_uuid:
                run(sql("UPDATE jobs SET project_uuid = $2 WHERE uuid = $1", job, project_uuid))
            run(database.update_workflow_state(job, "completed", 100))
            run(sql("UPDATE jobs SET status_code = 200, transcription_data = "
                    """'{"language": "en"}'::jsonb WHERE uuid = $1""", job))
            base = Path(file_name).stem
            made = {
                "audio": Path(settings.upload_dir, file_name),
                "transcript": Path(settings.transcript_dir, f"{base}.json"),
                "edited": Path(settings.transcript_edited_dir, f"{base}.json"),
                "summary": Path(settings.summary_dir, f"{job}.txt"),
                "asr": Path(asr_audio_path(settings.upload_dir, job)),
                "analysis": Path(channel_analysis_path(settings.upload_dir, job)),
                "left": Path(channel_asr_path(settings.upload_dir, job, 0)),
                "right": Path(channel_asr_path(settings.upload_dir, job, 1)),
            }
            for path in made.values():
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text("x", encoding="utf-8")
            run(CuePointRepository().create(job, 12.5, "morada", "ana"))
            return job, made

        job, made = new_job("call.wav")
        assert balance() == 2
        url = f"/api/v1/jobs/{job}/reprocess"

        # --- Only the administrator ---------------------------------------------
        assert client.post(url, headers=ana).status_code == 403
        assert run(sql("SELECT workflow_state FROM jobs WHERE uuid = $1", job)) == "completed"

        # --- Starting over from the very start ------------------------------------
        response = client.post(url, headers=admin)
        assert response.status_code == 202, response.text
        assert response.json()["workflow_state"] == "uploaded"
        row = run(sql("""SELECT json_build_object('state', workflow_state, 'language', language,
                                                  'model', model_name, 'speakers', num_speakers,
                                                  'data', transcription_data,
                                                  'refundable', token_refundable)
                         FROM jobs WHERE uuid = $1""", job))
        assert json.loads(row) == {"state": "uploaded", "language": None, "model": None,
                                   "speakers": 3, "data": None, "refundable": False}
        # Everything made from the first run goes, ASR copies included; the audio
        # and its cue points stay.
        assert [name for name, path in made.items() if path.exists()] == ["audio"]
        assert [c["note"] for c in run(CuePointRepository().list(job))] == ["morada"]
        assert balance() == 2  # free
        assert queue.notified == 0

        # Not while it is being processed.
        assert client.post(url, headers=admin).status_code == 409

        # --- A project audio goes back to the project queue ---------------------
        project = run(ProjectRepository().create(
            str(uuid_lib.uuid4()), "Caso", None, None, 7, ana_uuid))
        in_project, _ = new_job("p.wav", str(project["uuid"]))
        assert client.post(f"/api/v1/jobs/{in_project}/reprocess",
                           headers=admin).status_code == 202
        assert queue.notified == 1
