"""
Estimates of how long processing and AI tasks still take, against a real
PostgreSQL database: finishing a step records how long it took per second of
audio (only the latest runs are kept); the median of those times estimates
an audio's status, each audio of a project (a queued one waits for those
ahead of it) and a queued summary; without timings there is no estimate.

Skipped unless MEETMEMO_TEST_DATABASE_URL points at a disposable database (the
database is reset first; see test_tokens_integration).
"""
import sys
import types
import uuid as uuid_lib
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from types import SimpleNamespace

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

PYANNOTE = "pyannote/speaker-diarization-3.1"


def test_estimates_against_real_postgres(monkeypatch, tmp_path):
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
    from repositories.user_repository import UserRepository
    from services.eta import load_step_rates, load_task_durations
    from services.user_service import UserService

    # The jobs router imports the ML step services; the status does not use them.
    for name, cls in (("services.transcription_service", "TranscriptionService"),
                      ("services.diarization_service", "DiarizationService")):
        stub = types.ModuleType(name)
        setattr(stub, cls, type(cls, (), {}))
        monkeypatch.setitem(sys.modules, name, stub)
    routers = {name: _load(name) for name in ("auth", "jobs", "projects")}

    @asynccontextmanager
    async def lifespan(app):
        await database.init_database()
        await database.ensure_projects_schema()
        await database.ensure_users_schema()
        await database.ensure_tokens_schema("UTC")
        await database.ensure_tokens_schema("UTC")  # the estimate columns are idempotent too
        await database.ensure_llm_tasks_schema()
        await database.ensure_cue_points_schema()
        await database.require_owners()
        await database.ensure_admin_schema()
        await AdminRepository().create_credentials_if_missing(
            "admin", hash_password(ADMIN_PASSWORD)
        )
        app.state.project_queue = SimpleNamespace(current_job=None)
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

        created = run(UserService(settings).create("ana", "Ana", PASSWORD))
        ana_uuid = str(created["uuid"])
        run(UserRepository().set_password(ana_uuid, hash_password(PASSWORD), must_change=False))
        response = client.post("/api/v1/auth/login", headers=HEADERS,
                               json={"username": "ana", "password": PASSWORD})
        cookies = dict(response.cookies.items())
        client.cookies.clear()
        ana = {"Cookie": "; ".join(f"{k}={v}" for k, v in cookies.items()), **HEADERS}

        def new_job(seconds, model_name=None, project_uuid=None):
            job = str(uuid_lib.uuid4())
            run(database.add_job(job, f"{job}.wav", 202, f"h-{job}", model_name=model_name,
                                 user_uuid=ana_uuid))
            run(database.set_audio_seconds(job, seconds))
            if project_uuid:
                run(sql("UPDATE jobs SET project_uuid = $2 WHERE uuid = $1", job, project_uuid))
            return job

        def run_step(job, step, done, model, took):
            """A step that took `took` seconds."""
            run(database.update_workflow_state(job, step, 0, model))
            run(sql("UPDATE jobs SET step_started_at = NOW() - $2 * INTERVAL '1 second' "
                    "WHERE uuid = $1", job, took))
            run(database.update_workflow_state(job, done, 100))

        def eta(payload):
            return payload["eta_seconds"]

        # --- No timings yet: no estimate ------------------------------------------
        first = new_job(600)
        assert eta(client.get(f"/api/v1/jobs/{first}", headers=ana).json()) is None

        # --- Finishing each step records its time per second of audio -------------
        run_step(first, "transcribing", "transcribed", "large-v3", 300)
        run_step(first, "diarizing", "diarized", PYANNOTE, 120)
        run_step(first, "aligning", "completed", None, 6)
        rates = run(load_step_rates())
        assert rates.keys() == {("transcribing", "large-v3"), ("diarizing", PYANNOTE),
                                ("aligning", "")}
        assert rates[("transcribing", "large-v3")] == pytest.approx(0.5, abs=0.01)
        assert rates[("diarizing", PYANNOTE)] == pytest.approx(0.2, abs=0.01)
        assert run(sql("SELECT step_started_at FROM jobs WHERE uuid = $1", first)) is None
        # An error is not a finished step: nothing recorded.
        failed = new_job(600)
        run(database.update_workflow_state(failed, "transcribing", 0, "large-v3"))
        run(database.update_workflow_state(failed, "error", 0))
        assert run(sql("SELECT COUNT(*) FROM step_timings WHERE step = 'transcribing'")) == 1

        # --- A new audio is estimated from them -------------------------------------
        second = new_job(600)
        status = client.get(f"/api/v1/jobs/{second}", headers=ana).json()
        assert eta(status) == pytest.approx(426, abs=3)
        eta_at = datetime.fromisoformat(status["eta_at"].replace("Z", "+00:00"))
        assert abs((eta_at - datetime.now(timezone.utc)).total_seconds() - 426) < 5
        # Another Whisper model has no timings of its own yet.
        turbo = new_job(600, model_name="turbo")
        assert eta(client.get(f"/api/v1/jobs/{turbo}", headers=ana).json()) is None
        # A finished audio has nothing left.
        assert eta(client.get(f"/api/v1/jobs/{first}", headers=ana).json()) is None

        # --- Only the latest runs of each step and model are kept --------------------
        async def many_timings():
            async with database.get_db() as conn:
                await conn.executemany(
                    "INSERT INTO step_timings (step, model, audio_seconds, seconds, finished_at) "
                    "VALUES ('aligning', '', 100, 50, NOW() - INTERVAL '1 day')",
                    [()] * 60,
                )
        run(many_timings())
        run_step(new_job(100), "aligning", "completed", None, 1)
        assert run(sql("SELECT COUNT(*) FROM step_timings WHERE step = 'aligning'")) == 50

        # --- A queued project audio waits for those ahead of it ----------------------
        project = run(ProjectRepository().create(
            str(uuid_lib.uuid4()), "Inquérito 7", None, None, 30, ana_uuid
        ))
        project_uuid = str(project["uuid"])
        ahead = new_job(600, project_uuid=project_uuid)
        behind = new_job(60, project_uuid=project_uuid)
        run(sql("UPDATE jobs SET created_at = NOW() + INTERVAL '1 second' WHERE uuid = $1",
                behind))
        audios = {a["uuid"]: a for a in
                  client.get(f"/api/v1/projects/{project_uuid}", headers=ana).json()["audios"]}
        own = {uuid: client.get(f"/api/v1/jobs/{uuid}", headers=ana).json()["eta_seconds"]
               for uuid in (ahead, behind)}
        assert audios[ahead]["status"] == "queued"
        assert eta(audios[ahead]) == pytest.approx(own[ahead], abs=2)
        assert eta(audios[behind]) == pytest.approx(own[ahead] + own[behind], abs=2)
        assert audios[behind]["eta_at"] is not None

        # --- A queued summary takes the median of the latest summaries ---------------
        async def past_summaries():
            async with database.get_db() as conn:
                for seconds in (80, 90, 100):
                    await conn.execute(
                        """INSERT INTO llm_tasks (job_uuid, kind, status, started_at, finished_at)
                           VALUES ($1, 'summary', 'done',
                                   NOW() - $2 * INTERVAL '1 second', NOW())""",
                        first, seconds,
                    )
        tasks = LlmTaskRepository()
        assert run(tasks.with_eta(run(tasks.enqueue(second, "summary", None, "ana"))))[
            "eta_seconds"] is None
        run(past_summaries())
        assert run(load_task_durations())[("summary", "")] == pytest.approx(90)
        queued = run(tasks.with_eta(run(tasks.latest(second, "summary"))))
        assert queued["eta_seconds"] == 90
        assert queued["eta_at"] is not None
