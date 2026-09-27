"""The upload size limit is set in the admin panel and enforced on every upload."""
import asyncio
import importlib.util
import io
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi import FastAPI, HTTPException, UploadFile
from fastapi.testclient import TestClient
from pydantic import ValidationError
from runtime_settings import MAX_UPLOAD_MB_LIMIT, MIB, RuntimeSettings, default_runtime_settings
from services.audio_service import AudioService


class _Runtime:
    def __init__(self, max_upload_mb):
        self.settings = RuntimeSettings(whisper_model_name="large-v3", max_upload_mb=max_upload_mb)

    async def get(self):
        return self.settings


def _service(tmp_path, max_upload_mb):
    settings = SimpleNamespace(upload_dir=str(tmp_path))
    return AudioService(settings, job_repo=None, runtime_settings=_Runtime(max_upload_mb))


def _upload(size):
    return UploadFile(file=io.BytesIO(b"\0" * size), filename="call.wav")


def test_a_file_at_the_limit_is_accepted(tmp_path):
    name, _ = asyncio.run(_service(tmp_path, 1).upload_audio("job1", _upload(MIB)))
    assert (tmp_path / name).stat().st_size == MIB


def test_a_file_over_the_limit_is_refused_with_the_limit_in_the_message(tmp_path):
    with pytest.raises(HTTPException) as excinfo:
        asyncio.run(_service(tmp_path, 1).upload_audio("job1", _upload(MIB + 1)))

    assert excinfo.value.status_code == 413
    assert excinfo.value.detail == "File too large. Maximum size: 1 MB"
    assert list(tmp_path.iterdir()) == []


@pytest.mark.parametrize("env_bytes, expected", [
    (100 * MIB, 100), (MIB // 2, 1), (2048 * MIB, MAX_UPLOAD_MB_LIMIT),
])
def test_the_default_comes_from_the_environment_within_the_allowed_range(env_bytes, expected):
    assert default_runtime_settings("large-v3", 12, env_bytes).max_upload_mb == expected


@pytest.mark.parametrize("value", [0, MAX_UPLOAD_MB_LIMIT + 1])
def test_the_panel_cannot_set_a_limit_outside_1_to_500_mb(value):
    with pytest.raises(ValidationError):
        RuntimeSettings(whisper_model_name="large-v3", max_upload_mb=value)


def test_the_upload_screen_is_told_the_limit(monkeypatch):
    spec = importlib.util.spec_from_file_location(
        "system_api_under_test", Path(__file__).resolve().parents[1] / "api" / "v1" / "system.py"
    )
    system_api = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(system_api)
    runtime = _Runtime(250)

    async def saved_settings(_service):
        return runtime.settings

    monkeypatch.setattr(system_api.RuntimeSettingsService, "get", saved_settings)

    app = FastAPI()
    app.include_router(system_api.router, prefix="/api/v1")
    app.dependency_overrides[system_api.get_settings] = lambda: SimpleNamespace()

    body = TestClient(app).get("/api/v1/config").json()
    assert body == {"default_language": None, "max_upload_mb": 250}
