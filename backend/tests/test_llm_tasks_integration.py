"""
Background summaries and translations against a real PostgreSQL database:
asking queues one task per audio and kind (asking again returns it), the
worker runs them in order with a (fake) language model, the results are then
served from the caches, failures carry a code the page explains, a restart
puts interrupted tasks back in the queue, and only the audio's owner (or the
administrator) sees any of it.

Skipped unless MEETMEMO_TEST_DATABASE_URL points at a disposable database, e.g.
    MEETMEMO_TEST_DATABASE_URL=postgresql://postgres@localhost:5432/meetmemo_test
The database is reset (all MeetMemo tables dropped) before the test runs.
"""
import json
import json as json_lib
import uuid as uuid_lib
from contextlib import asynccontextmanager
from pathlib import Path

import httpx
import pytest

from tests.test_tokens_integration import (
    ADMIN_PASSWORD,
    HEADERS,
    TEST_DATABASE_URL,
    _load,
    _reset_database,
    _settings,
)

pytestmark = pytest.mark.skipif(
    not TEST_DATABASE_URL, reason="MEETMEMO_TEST_DATABASE_URL not set"
)

SEGMENTS = [
    {"speaker": "SPEAKER_00", "start": float(i), "end": i + 1.0, "text": f"line {i}"}
    for i in range(20)
]


class _FakeLlm:
    """An OpenAI-style chat endpoint: translates JSON blocks, summarizes anything else."""

    def __init__(self):
        self.calls = 0
        self.fail_with = None

    async def post(self, url, headers=None, json=None, timeout=None):  # noqa: A002
        self.calls += 1
        if self.fail_with:
            raise self.fail_with
        user = json["messages"][-1]["content"]
        try:
            block = json_lib.loads(user)
            content = json_lib.dumps(
                [{"i": item["i"], "text": f"PT: {item['text']}"} for item in block]
            )
        except ValueError:
            content = "# Resumo\n\nA chamada tratou de vinte linhas."
        return httpx.Response(
            200,
            json={"choices": [{"message": {"content": content}, "finish_reason": "stop"}]},
            request=httpx.Request("POST", url),
        )


def test_background_llm_tasks_against_real_postgres(monkeypatch, tmp_path):
    # pylint: disable=import-outside-toplevel,too-many-locals,too-many-statements
    from fastapi import FastAPI
    from fastapi.testclient import TestClient

    _reset_database()
    settings = _settings(tmp_path)
    settings.summary_path = Path(settings.summary_dir)
    settings.llm_api_url = "http://fake-llm"
    settings.llm_model_name = "fake-model"
    settings.llm_timeout = 60.0
    settings.llm_api_key = None
    monkeypatch.setenv("DATABASE_URL", TEST_DATABASE_URL)

    import database
    from admin_auth import hash_password
    from repositories.admin_repository import AdminRepository
    from repositories.job_repository import JobRepository
    from repositories.llm_task_repository import LlmTaskRepository
    from services.llm_tasks import LlmTaskQueue, LlmTaskRunner
    from services.summary_service import SummaryService
    from services.user_service import UserService

    routers = {name: _load(name) for name in ("auth", "admin", "transcripts", "summaries")}
    llm = _FakeLlm()
    summary_service = SummaryService(llm, settings)

    @asynccontextmanager
    async def lifespan(_app):
        await database.init_database()
        await database.ensure_projects_schema()
        await database.ensure_users_schema()
        await database.ensure_tokens_schema()
        await database.ensure_llm_tasks_schema()
        await database.ensure_llm_tasks_schema()  # idempotent on an existing schema
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
        if hasattr(module, "get_summary_service"):
            app.dependency_overrides[module.get_summary_service] = lambda: summary_service

    with TestClient(app) as client:

        def run(coro):
            async def call():
                return await coro

            return client.portal.call(call)

        def login(username, password):
            response = client.post("/api/v1/auth/login", headers=HEADERS,
                                   json={"username": username, "password": password})
            assert response.status_code == 200, response.text
            cookies = dict(response.cookies.items())
            client.cookies.clear()
            return {"Cookie": "; ".join(f"{k}={v}" for k, v in cookies.items()), **HEADERS}

        from repositories.user_repository import UserRepository

        users = {}
        for name in ("ana", "bruno"):
            created = run(UserService(settings).create(name, name.title(), f"{name} password 1"))
            run(UserRepository().set_password(
                str(created["uuid"]), hash_password(f"{name} password 1"), must_change=False))
            users[name] = str(created["uuid"])
        ana = login("ana", "ana password 1")
        bruno = login("bruno", "bruno password 1")
        admin = login("admin", ADMIN_PASSWORD)

        def new_job(file_name):
            job_uuid = str(uuid_lib.uuid4())
            run(database.add_job(job_uuid, file_name, 200, f"h-{job_uuid}",
                                 user_uuid=users["ana"]))
            Path(settings.transcript_dir, Path(file_name).stem + ".json").write_text(
                json.dumps(SEGMENTS), encoding="utf-8"
            )
            return job_uuid

        job = new_job("call.wav")
        other = new_job("other.wav")
        tasks = LlmTaskRepository()
        queue = LlmTaskQueue(
            tasks, LlmTaskRunner(settings, tasks, JobRepository(), summary_service).run
        )
        base = f"/api/v1/jobs/{job}"

        # --- Asking queues one task per audio and kind --------------------------
        first = client.post(f"{base}/transcripts/translate", headers=ana)
        assert first.status_code == 202
        task = first.json()["task"]
        assert (task["status"], task["queue_position"], first.json()["total"]) == (
            "queued", 0, 20
        )
        again = client.post(f"{base}/transcripts/translate", headers=ana)
        assert again.json()["task"]["id"] == task["id"]
        summary_ask = client.post(f"{base}/summaries", headers=ana, json={})
        assert summary_ask.status_code == 202
        assert summary_ask.json()["task"]["queue_position"] == 1  # behind the translation
        assert llm.calls == 0  # nothing ran inside the requests

        # Only the owner (and the administrator) see the audio's tasks.
        assert client.get(f"{base}/transcripts/translation", headers=bruno).status_code == 404
        assert client.post(f"{base}/summaries", headers=bruno, json={}).status_code == 404
        polled = client.get(f"{base}/transcripts/translation", headers=admin).json()
        assert (polled["status"], polled["task"]["id"]) == ("queued", task["id"])

        # --- The worker runs them in order; the results are then served --------
        assert run(queue.run_next()) is True
        translation = client.get(f"{base}/transcripts/translation", headers=ana).json()
        assert translation["status"] == "cached"
        assert [s["text"] for s in translation["segments"]] == [f"PT: line {i}" for i in range(20)]
        assert translation["task"] is None
        assert run(tasks.latest(job, "translation"))["progress_done"] == 20
        assert client.post(f"{base}/transcripts/translate", headers=ana).status_code == 200

        pending = client.get(f"{base}/summaries", headers=ana).json()
        assert (pending["status"], pending["summary"]) == ("queued", None)
        assert run(queue.run_next()) is True
        done = client.get(f"{base}/summaries", headers=ana).json()
        assert done["status"] == "cached"
        assert done["summary"].startswith("# Resumo")
        assert run(queue.run_next()) is False  # queue empty

        # A cached summary is served at once, unless a new one is asked for.
        cached = client.post(f"{base}/summaries", headers=ana, json={})
        assert (cached.status_code, cached.json()["status"]) == (200, "cached")
        redo = client.post(f"{base}/summaries", headers=ana, json={"regenerate": True})
        assert redo.status_code == 202
        custom = client.post(f"{base}/summaries", headers=ana,
                             json={"custom_prompt": "Só os nomes."})
        assert custom.json()["task"]["id"] == redo.json()["task"]["id"]  # one at a time
        both = client.get(f"{base}/summaries", headers=ana).json()
        assert both["status"] == "cached" and both["task"]["status"] == "queued"

        # --- A failure is kept with a code the page explains --------------------
        llm.fail_with = httpx.ReadTimeout("")
        assert run(queue.run_next()) is True
        failed = client.get(f"{base}/summaries", headers=ana).json()
        assert failed["status"] == "cached"  # the previous summary stays
        assert failed["task"]["status"] == "error"
        assert failed["task"]["error_code"] == "timeout"
        assert "LLM_TIMEOUT" in failed["task"]["error"]
        llm.fail_with = None

        # Asking again after a failure queues a new task.
        retried = client.post(f"{base}/summaries", headers=ana, json={"regenerate": True})
        assert retried.json()["task"]["id"] != failed["task"]["id"]
        assert run(queue.run_next()) is True
        assert client.get(f"{base}/summaries", headers=ana).json()["task"] is None

        # --- A restart puts the task it interrupted back in the queue ----------
        client.post(f"/api/v1/jobs/{other}/transcripts/translate", headers=ana)
        claimed = run(tasks.claim_next())
        assert claimed["status"] == "running"
        assert run(tasks.requeue_interrupted()) == 1
        assert run(tasks.latest(other, "translation"))["status"] == "queued"

        # --- Deleting the audio deletes its tasks --------------------------------
        async def count_tasks(job_uuid):
            async with database.get_db() as conn:
                return await conn.fetchval(
                    "SELECT COUNT(*) FROM llm_tasks WHERE job_uuid = $1", job_uuid
                )

        assert run(count_tasks(other)) == 1
        run(database.delete_job(other))
        assert run(count_tasks(other)) == 0
        assert run(queue.run_next()) is False
