"""
End-to-end projects test against a real PostgreSQL database: the API, the
server-side queue, per-project duplicates, complete deletion and expiry.

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
from types import SimpleNamespace

import pytest

TEST_DATABASE_URL = os.getenv("MEETMEMO_TEST_DATABASE_URL")
pytestmark = pytest.mark.skipif(
    not TEST_DATABASE_URL, reason="MEETMEMO_TEST_DATABASE_URL not set"
)

MIGRATIONS = Path(__file__).resolve().parents[1] / "migrations"


def _reset_database():
    import asyncpg  # pylint: disable=import-outside-toplevel

    async def reset():
        conn = await asyncpg.connect(TEST_DATABASE_URL)
        try:
            await conn.execute("DROP SCHEMA public CASCADE; CREATE SCHEMA public;")
            # An installation from before projects existed.
            for name in ("001_init_schema.sql", "002_add_language_model_fields.sql",
                         "003_admin_panel.sql"):
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
    )


def _touch(path):
    Path(path).write_text("x", encoding="utf-8")
    return str(path)


def test_projects_against_real_postgres(monkeypatch, tmp_path):
    # pylint: disable=import-outside-toplevel,too-many-locals,too-many-statements
    from fastapi import FastAPI
    from fastapi.testclient import TestClient

    _reset_database()
    monkeypatch.setenv("DATABASE_URL", TEST_DATABASE_URL)

    import database
    from repositories.job_repository import JobRepository
    from repositories.project_repository import ProjectRepository
    from services.audio_service import AudioService
    from services.project_queue import ProjectQueue
    from services.project_service import ProjectService

    spec = importlib.util.spec_from_file_location(
        "projects_api_integration",
        Path(__file__).resolve().parents[1] / "api" / "v1" / "projects.py",
    )
    projects_api = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(projects_api)

    settings = _settings(tmp_path)

    class Pipeline:
        """Stands in for the ML steps: writes the transcript and completes."""

        def __init__(self):
            self.fail = set()

        async def run_remaining(self, job):
            if job["file_name"] in self.fail:
                raise ValueError("Unsupported model: evil")
            base = os.path.splitext(job["file_name"])[0]
            _touch(os.path.join(settings.transcript_dir, f"{base}.json"))
            await database.update_workflow_state(str(job["uuid"]), "completed", 100)

    pipeline = Pipeline()
    repo = ProjectRepository()
    queue = ProjectQueue(repo, ProjectService(settings, repo, pipeline=pipeline).process)

    @asynccontextmanager
    async def lifespan(_app):
        await database.init_database()
        await database.ensure_projects_schema()
        await database.ensure_projects_schema()  # idempotent on an existing schema
        await database.ensure_admin_schema()
        yield
        await database.close_database()

    app = FastAPI(lifespan=lifespan)
    app.include_router(projects_api.router, prefix="/api/v1")
    app.state.project_queue = queue
    app.dependency_overrides[projects_api.get_settings] = lambda: settings
    app.dependency_overrides[projects_api.get_audio_service] = (
        lambda: AudioService(settings, JobRepository())
    )

    with TestClient(app) as client:

        def run(coro):
            """Run a coroutine on the app's event loop, where the pool lives."""

            async def call():
                return await coro

            return client.portal.call(call)

        # --- Create --------------------------------------------------------------
        body = client.post(
            "/api/v1/projects",
            json={"name": "  Caso 12  ", "reference": "NUIPC 1/26", "description": ""},
        )
        assert body.status_code == 201, body.text
        project = body.json()
        pid = project["uuid"]
        assert (project["name"], project["reference"], project["description"]) == (
            "Caso 12", "NUIPC 1/26", None
        )
        expires = datetime.fromisoformat(project["expires_at"])
        expected = datetime.now(timezone.utc) + timedelta(days=7)
        assert abs((expires - expected).total_seconds()) < 60
        assert client.post("/api/v1/projects", json={"name": "  "}).status_code == 422

        listing = client.get("/api/v1/projects").json()
        assert listing["retention_days"] == 7
        assert [p["uuid"] for p in listing["projects"]] == [pid]

        # --- Upload several audios -------------------------------------------------
        files = [
            ("files", ("chamada 1.wav", b"RIFF-one", "audio/wav")),
            ("files", ("chamada 2.wav", b"RIFF-two", "audio/wav")),
            ("files", ("chamada 1 copia.wav", b"RIFF-one", "audio/wav")),
            ("files", ("notas.txt", b"text", "text/plain")),
        ]
        response = client.post(
            f"/api/v1/projects/{pid}/audios", files=files, data={"language": "pt"}
        )
        assert response.status_code == 200, response.text
        results = response.json()["results"]
        assert [r["status"] for r in results] == ["queued", "queued", "duplicate", "rejected"]
        first, second = results[0]["uuid"], results[1]["uuid"]
        assert results[2]["uuid"] == first
        assert client.post(
            f"/api/v1/projects/{pid}/audios", files=files[:1], data={"language": "zz"}
        ).status_code == 400

        detail = client.get(f"/api/v1/projects/{pid}").json()
        assert [(a["status"], a["queue_position"], a["language"]) for a in detail["audios"]] == [
            ("queued", 1, "pt"), ("queued", 2, "pt")
        ]

        # Project audios stay out of the single-audio history and duplicates.
        assert run(database.get_all_jobs()) == []
        assert run(database.get_jobs_count()) == 0
        job = run(database.get_job(first))
        assert str(job["project_uuid"]) == pid
        assert run(database.get_job_by_hash(job["file_hash"])) is None

        # --- The queue processes them in order -------------------------------------
        pipeline.fail.add(run(database.get_job(second))["file_name"])
        assert run(queue.run_next()) is True
        assert run(queue.run_next()) is True
        assert run(queue.run_next()) is False
        detail = client.get(f"/api/v1/projects/{pid}").json()
        assert [a["status"] for a in detail["audios"]] == ["completed", "error"]
        assert detail["audios"][1]["error_message"] == "Unsupported model: evil"

        # A failed audio can be queued again; a completed one cannot.
        assert client.post(f"/api/v1/projects/{pid}/audios/{second}/retry").status_code == 204
        assert client.post(f"/api/v1/projects/{pid}/audios/{first}/retry").status_code == 409
        pipeline.fail.clear()
        assert run(queue.run_next()) is True

        listing = client.get("/api/v1/projects").json()["projects"][0]
        assert (listing["audio_count"], listing["completed_count"], listing["error_count"]) == (
            2, 2, 0
        )

        # --- A restart mid-step resumes before that step ---------------------------
        run(database.update_workflow_state(second, "diarizing", 40))
        assert run(repo.requeue_interrupted()) == 1
        assert run(database.get_job(second))["workflow_state"] == "transcribed"
        run(database.update_workflow_state(second, "completed", 100))

        # --- Deleting one audio removes all its files ------------------------------
        name = run(database.get_job(first))["file_name"]
        base = os.path.splitext(name)[0]
        leftovers = [
            os.path.join(settings.upload_dir, name),
            os.path.join(settings.transcript_dir, f"{base}.json"),
            _touch(os.path.join(settings.transcript_edited_dir, f"{base}.json")),
            _touch(os.path.join(settings.summary_dir, f"{first}.txt")),
            _touch(os.path.join(settings.translation_dir, f"{base}.pt-PT.json")),
            _touch(os.path.join(settings.export_dir, "first.docx")),
        ]
        run(database.add_export_job("11111111-1111-1111-1111-111111111111", first, "markdown",
                                    202))
        run(database.update_export_file_path("11111111-1111-1111-1111-111111111111",
                                             leftovers[-1]))
        assert all(os.path.exists(p) for p in leftovers)
        assert client.delete(f"/api/v1/projects/{pid}/audios/{first}").status_code == 204
        assert not any(os.path.exists(p) for p in leftovers)
        assert client.delete(f"/api/v1/projects/{pid}/audios/{first}").status_code == 404

        # --- Editing details never changes the expiry ------------------------------
        edited = client.patch(f"/api/v1/projects/{pid}", json={"name": "Caso 12-A"}).json()
        assert edited["name"] == "Caso 12-A" and edited["expires_at"] == project["expires_at"]

        # --- Expiry: hidden at once, then deleted in full ---------------------------
        second_name = run(database.get_job(second))["file_name"]
        second_audio = os.path.join(settings.upload_dir, second_name)
        assert os.path.exists(second_audio)

        async def expire():
            async with database.get_db() as conn:
                await conn.execute(
                    "UPDATE projects SET expires_at = NOW() - INTERVAL '1 second'"
                )

        run(expire())
        assert client.get(f"/api/v1/projects/{pid}").status_code == 404
        assert client.get("/api/v1/projects").json()["projects"] == []
        assert run(repo.next_queued_job()) is None
        assert run(ProjectService(settings, repo).delete_expired()) == 1
        assert not os.path.exists(second_audio)
        assert run(database.get_job(second)) is None

        # --- Global retention ignores projects and removes exports too -------------
        other = client.post("/api/v1/projects", json={"name": "Caso 13"}).json()["uuid"]
        client.post(f"/api/v1/projects/{other}/audios",
                    files=[("files", ("x.wav", b"RIFF-x", "audio/wav"))])
        run(database.add_job("22222222-2222-2222-2222-222222222222", "solo.wav", 200, "h"))
        run(database.add_export_job("33333333-3333-3333-3333-333333333333",
                                    "22222222-2222-2222-2222-222222222222", "markdown", 200))
        run(database.update_export_file_path("33333333-3333-3333-3333-333333333333",
                                             "/exports/solo.md"))

        async def age_everything():
            async with database.get_db() as conn:
                await conn.execute("UPDATE jobs SET created_at = NOW() - INTERVAL '2 days'")

        run(age_everything())
        old = run(database.cleanup_old_jobs(12))
        assert [(str(j["uuid"]), list(j["export_paths"])) for j in old] == [
            ("22222222-2222-2222-2222-222222222222", ["/exports/solo.md"])
        ]
        assert len(client.get(f"/api/v1/projects/{other}").json()["audios"]) == 1

        # --- Deleting a project ----------------------------------------------------
        assert client.delete(f"/api/v1/projects/{other}").status_code == 204
        assert client.delete(f"/api/v1/projects/{other}").status_code == 404
        assert client.get("/api/v1/projects/not-a-uuid").status_code == 422
        assert os.listdir(settings.upload_dir) == []
