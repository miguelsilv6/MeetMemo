"""
Summaries and translations are always produced in European Portuguese.

Service-level tests capture the prompts sent to a fake LLM client; the router
tests drive the real translate endpoint with an in-memory job repository.
transcripts.py is loaded straight from its file: importing it through the
api.v1 package would import every router, including ones that need torch.
"""
import asyncio
import importlib.util
import json
from pathlib import Path
from types import SimpleNamespace

from fastapi import FastAPI
from fastapi.testclient import TestClient
from services.summary_service import (
    EUROPEAN_PORTUGUESE_REMINDER,
    EUROPEAN_PORTUGUESE_RULE,
    SummaryService,
)

TRANSCRIPT = (
    "SPEAKER_00: Good morning, this is Ana from customer support, how can I help?\n"
    "SPEAKER_01: My order has not arrived yet although tracking says it was delivered."
)


def _fake_settings(**overrides):
    values = {
        "llm_api_url": "http://fake-llm",
        "llm_model_name": "fake-model",
        "llm_api_key": None,
        "llm_json_mode": True,
        "llm_timeout": 60.0,
    }
    values.update(overrides)
    return SimpleNamespace(**values)


class _FakeResponse:
    def __init__(self, content: str):
        self._content = content

    def raise_for_status(self):
        return None

    def json(self):
        return {"choices": [{"message": {"content": self._content}}]}


class _FakeClient:
    """Captures every POST payload and returns a canned completion."""

    def __init__(self, content="# Resumo"):
        self.content = content
        self.payloads = []

    async def post(self, url, headers=None, json=None, timeout=None):
        self.payloads.append(json)
        return _FakeResponse(self.content)


def _messages(client):
    messages = client.payloads[-1]["messages"]
    return messages[0]["content"], messages[1]["content"]


# --- Summaries ---------------------------------------------------------------


def test_default_summary_prompt_requires_european_portuguese():
    client = _FakeClient()
    asyncio.run(SummaryService(client, _fake_settings()).summarize(TRANSCRIPT))

    system, user = _messages(client)
    assert system.endswith(EUROPEAN_PORTUGUESE_RULE)
    assert "português de Portugal" in system
    assert "Nunca uses português do Brasil" in system
    assert TRANSCRIPT in user
    assert user.endswith(EUROPEAN_PORTUGUESE_REMINDER)


def test_custom_prompts_cannot_drop_the_european_portuguese_rule():
    client = _FakeClient()
    service = SummaryService(client, _fake_settings())
    asyncio.run(
        service.summarize(
            TRANSCRIPT,
            custom_prompt="List only the action items.",
            system_prompt="You are a terse assistant. Answer in English.",
        )
    )

    system, user = _messages(client)
    assert system.startswith("You are a terse assistant. Answer in English.")
    assert system.endswith(EUROPEAN_PORTUGUESE_RULE)
    assert user.startswith("List only the action items.")
    assert user.endswith(EUROPEAN_PORTUGUESE_REMINDER)


def test_short_and_empty_recordings_get_portuguese_placeholders():
    client = _FakeClient()
    service = SummaryService(client, _fake_settings())

    empty = asyncio.run(service.summarize("   "))
    short = asyncio.run(service.summarize("SPEAKER_00: Olá."))

    assert empty.startswith("# Sem conteúdo disponível")
    assert short.startswith("# Resumo de gravação breve")
    assert '"SPEAKER_00: Olá."' in short
    assert client.payloads == []  # neither needs the LLM


# --- Translation (service) ---------------------------------------------------


def test_translation_prompt_targets_european_portuguese():
    client = _FakeClient(content='[{"i": 0, "text": "Bom dia"}]')
    service = SummaryService(client, _fake_settings())
    result = asyncio.run(service.translate_segments([{"speaker": "A", "text": "Good morning"}]))

    system, _ = _messages(client)
    assert "European Portuguese (Portugal)" in system
    assert system.endswith(EUROPEAN_PORTUGUESE_RULE)
    assert result == [{"speaker": "A", "text": "Bom dia"}]


# --- Translation (endpoint) --------------------------------------------------

_spec = importlib.util.spec_from_file_location(
    "transcripts_api_under_test",
    Path(__file__).resolve().parents[1] / "api" / "v1" / "transcripts.py",
)
transcripts_api = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(transcripts_api)

SEGMENTS = [{"speaker": "SPEAKER_00", "start": 0.0, "end": 1.0, "text": "Good morning"}]


class _FakeJobRepository:
    def __init__(self, language):
        self.language = language

    async def get(self, uuid):
        return {"uuid": uuid, "file_name": "call.wav"}

    async def get_transcription(self, uuid):
        return {"language": self.language} if self.language else None


class _FakeTranslator:
    def __init__(self):
        self.calls = 0

    async def translate_segments(self, segments):
        self.calls += 1
        return [{**segment, "text": "Bom dia"} for segment in segments]


def _client(tmp_path, language):
    transcript_dir = tmp_path / "transcripts"
    transcript_dir.mkdir()
    (transcript_dir / "call.json").write_text(json.dumps(SEGMENTS), encoding="utf-8")
    settings = SimpleNamespace(
        transcript_dir=str(transcript_dir),
        transcript_edited_dir=str(tmp_path / "edited"),
        translation_dir=str(tmp_path / "translations"),
    )
    translator = _FakeTranslator()

    app = FastAPI()
    app.include_router(transcripts_api.router, prefix="/api/v1")
    app.dependency_overrides[transcripts_api.get_job_repository] = lambda: _FakeJobRepository(
        language
    )
    app.dependency_overrides[transcripts_api.get_summary_service] = lambda: translator
    app.dependency_overrides[transcripts_api.get_settings] = lambda: settings
    return TestClient(app), translator, tmp_path / "translations"


def test_portuguese_transcript_is_returned_unchanged(tmp_path):
    client, translator, translation_dir = _client(tmp_path, "pt")

    response = client.post("/api/v1/jobs/job1/transcripts/translate")

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "original"
    assert body["segments"] == SEGMENTS
    assert translator.calls == 0
    assert not translation_dir.exists()


def test_other_languages_are_translated_and_cached_as_european_portuguese(tmp_path):
    client, translator, translation_dir = _client(tmp_path, "en")

    first = client.post("/api/v1/jobs/job1/transcripts/translate", json={"target_language": "pt"})
    second = client.post("/api/v1/jobs/job1/transcripts/translate")

    assert first.json()["status"] == "generated"
    assert first.json()["target_language"] == "pt-PT"
    assert first.json()["segments"][0]["text"] == "Bom dia"
    assert second.json()["status"] == "cached"
    assert translator.calls == 1
    assert (translation_dir / "call.pt-PT.json").exists()


def test_translation_ignores_a_cache_from_before_european_portuguese(tmp_path):
    client, translator, translation_dir = _client(tmp_path, "en")
    translation_dir.mkdir()
    (translation_dir / "call.pt.json").write_text(
        json.dumps([{**SEGMENTS[0], "text": "Bom dia (Brasil)"}]), encoding="utf-8"
    )

    response = client.post("/api/v1/jobs/job1/transcripts/translate")

    assert response.json()["status"] == "generated"
    assert translator.calls == 1


def test_translation_to_another_language_is_rejected(tmp_path):
    client, translator, _ = _client(tmp_path, "en")

    response = client.post(
        "/api/v1/jobs/job1/transcripts/translate", json={"target_language": "en"}
    )

    assert response.status_code == 422
    assert translator.calls == 0
