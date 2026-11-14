"""
The administrator reading how an audio was processed, against a real PostgreSQL
database: only the administrator may ask, an unknown audio is a 404, and the
answer comes from what processing stored (the diarization model that really
made the speakers, and the settings the transcription ran with).

Skipped unless MEETMEMO_TEST_DATABASE_URL points at a disposable database (the
database is reset first; see test_tokens_integration).
"""
import sys
import types
import uuid as uuid_lib
from contextlib import asynccontextmanager

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


def test_processing_info_against_real_postgres(monkeypatch, tmp_path):
    # pylint: disable=import-outside-toplevel,too-many-locals
    from fastapi import FastAPI
    from fastapi.testclient import TestClient

    _reset_database()
    settings = _settings(tmp_path)
    monkeypatch.setenv("DATABASE_URL", TEST_DATABASE_URL)

    import database
    from admin_auth import hash_password
    from repositories.admin_repository import AdminRepository
    from repositories.user_repository import UserRepository
    from runtime_settings import NEMOTRON_DIARIZATION, RuntimeSettings
    from services.user_service import UserService

    # The jobs router imports the ML step services; this endpoint does not use them.
    for name, cls in (("services.transcription_service", "TranscriptionService"),
                      ("services.diarization_service", "DiarizationService")):
        stub = types.ModuleType(name)
        setattr(stub, cls, type(cls, (), {}))
        monkeypatch.setitem(sys.modules, name, stub)
    routers = {name: _load(name) for name in ("auth", "admin")}

    @asynccontextmanager
    async def lifespan(_app):
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

        created = run(UserService(settings).create("ana", "Ana", PASSWORD))
        ana_uuid = str(created["uuid"])
        run(UserRepository().set_password(ana_uuid, hash_password(PASSWORD), must_change=False))
        ana = sign_in("ana", PASSWORD)
        admin = sign_in("admin", ADMIN_PASSWORD)

        job = str(uuid_lib.uuid4())
        run(database.add_job(job, "chamada.wav", 200, f"h-{job}", model_name="turbo",
                             user_uuid=ana_uuid, num_speakers=2))
        url = f"/api/v1/admin/jobs/{job}/processing"

        # --- Only the administrator may ask ----------------------------------------
        assert client.get(url, headers=ana).status_code == 401
        assert client.get(url).status_code == 401
        assert client.get(f"/api/v1/admin/jobs/{uuid_lib.uuid4()}/processing",
                          headers=admin).status_code == 404

        # --- Not processed yet: what the upload gave --------------------------------
        before = client.get(url, headers=admin).json()
        assert before["whisper_model"] == "turbo"
        assert before["num_speakers"] == 2
        assert before["settings"] is None and before["diarization_model"] is None

        # --- Processed: what the steps stored (not the admin panel's present state) -
        runtime = RuntimeSettings(whisper_model_name="large-v3", beam_size=8,
                                  diarization_model="pyannote/speaker-diarization-3.1")
        run(database.save_transcription_data(job, {
            "model_name": "large-v3", "language": "pt", "language_probability": 0.91,
            "language_detection": {}, "duration": 62.5, "channel_mode": "mono",
            "segments": [], "settings": runtime.model_dump(),
        }))
        run(database.save_diarization_data(job, {"model": NEMOTRON_DIARIZATION,
                                                 "segments": []}))
        after = client.get(url, headers=admin).json()
        assert after["whisper_model"] == "large-v3"
        assert after["diarization_model"] == NEMOTRON_DIARIZATION
        assert after["diarization_by_channels"] is False
        assert after["language"] == {"code": "pt", "probability": 0.91, "forced": False}
        assert after["channel_mode"] == "mono"
        assert after["duration_seconds"] == 62.5
        assert after["settings"]["beam_size"] == 8
        assert after["settings"]["hallucination_phrases_count"] > 0
