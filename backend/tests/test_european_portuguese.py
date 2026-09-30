"""
Summaries and translations are always produced in European Portuguese.

Service-level tests capture the prompts sent to a fake LLM client; the
translation tests drive the real endpoints and background task runner with
in-memory repositories.
transcripts.py is loaded straight from its file: importing it through the
api.v1 package would import every router, including ones that need torch.
"""
import asyncio
import importlib.util
import json
from pathlib import Path
from types import SimpleNamespace

import httpx
import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient
from llm_prompts import EUROPEAN_PORTUGUESE_REMINDER, EUROPEAN_PORTUGUESE_RULE
from services import llm_tasks
from services.summary_service import SummaryService

from tests.auth_helpers import REQUEST_HEADERS, sign_in

TRANSCRIPT = (
    "SPEAKER_00: Good morning, this is Ana from customer support, how can I help?\n"
    "SPEAKER_01: My order has not arrived yet although tracking says it was delivered."
)


def _fake_settings(**overrides):
    values = {
        "llm_api_url": "http://fake-llm",
        "llm_model_name": "fake-model",
        "llm_api_key": None,
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


# --- Translation (background task and endpoints) ----------------------------

_spec = importlib.util.spec_from_file_location(
    "transcripts_api_under_test",
    Path(__file__).resolve().parents[1] / "api" / "v1" / "transcripts.py",
)
transcripts_api = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(transcripts_api)

JOB = {"uuid": "1b4e28ba-2fa1-11d2-883f-0016d3cca427", "file_name": "call.wav"}
TRANSLATE_URL = f"/api/v1/jobs/{JOB['uuid']}/transcripts/translate"
TRANSLATION_URL = f"/api/v1/jobs/{JOB['uuid']}/transcripts/translation"
SEGMENTS = [{"speaker": "SPEAKER_00", "start": 0.0, "end": 1.0, "text": "Good morning"}]


class _FakeJobRepository:
    def __init__(self, language):
        self.language = language

    async def get(self, uuid):
        return dict(JOB, uuid=uuid)

    async def get_transcription(self, uuid):
        return {"language": self.language} if self.language else None


class _FakeTranslator:
    """Translates to "PT: <text>" (or "Bom dia"), recording each block's size."""

    def __init__(self, fail_on_call=None, on_call=None):
        self.calls = 0
        self.block_sizes = []
        self.fail_on_call = fail_on_call
        self.on_call = on_call

    async def translate_segments(self, segments):
        self.calls += 1
        if self.on_call:
            self.on_call(self.calls)
        if self.calls == self.fail_on_call:
            raise HTTPException(status_code=503, detail="LLM timed out")
        self.block_sizes.append(len(segments))
        return [
            {**segment, "text": "Bom dia" if segment["text"] == "Good morning"
             else f"PT: {segment['text']}"}
            for segment in segments
        ]


class _FakeTasks:
    """In-memory LlmTaskRepository: enqueue returns the active task if any."""

    def __init__(self):
        self.tasks = []

    async def enqueue(self, job_uuid, kind, params, requested_by):
        for task in self.tasks:
            if (task["job_uuid"], task["kind"]) == (job_uuid, kind) and \
                    task["status"] in ("queued", "running"):
                return task
        task = {"id": len(self.tasks) + 1, "job_uuid": job_uuid, "kind": kind,
                "status": "queued", "progress_done": 0, "progress_total": 0,
                "queue_position": 0, "error_code": None, "error": None,
                "params": params or {}, "requested_by": requested_by}
        self.tasks.append(task)
        return task

    async def latest(self, job_uuid, kind):
        matching = [t for t in self.tasks if (t["job_uuid"], t["kind"]) == (job_uuid, kind)]
        return matching[-1] if matching else None

    async def set_progress(self, task_id, done, total):
        self.tasks[task_id - 1].update(progress_done=done, progress_total=total)

    async def finish(self, task_id):
        self.tasks[task_id - 1]["status"] = "done"

    async def fail(self, task_id, code, message):
        self.tasks[task_id - 1].update(status="error", error_code=code, error=message)


def _numbered_segments(count):
    return [
        {"speaker": "SPEAKER_00", "start": float(i), "end": i + 1.0, "text": f"line {i}"}
        for i in range(count)
    ]


def _settings(tmp_path, segments=None):
    transcript_dir = tmp_path / "transcripts"
    if not transcript_dir.exists():
        transcript_dir.mkdir()
        (transcript_dir / "call.json").write_text(
            json.dumps(SEGMENTS if segments is None else segments), encoding="utf-8"
        )
    return SimpleNamespace(
        transcript_dir=str(transcript_dir),
        transcript_edited_dir=str(tmp_path / "edited"),
        translation_dir=str(tmp_path / "translations"),
    )


def _client(tmp_path, language, segments=None, tasks=None):
    settings = _settings(tmp_path, segments)
    tasks = tasks or _FakeTasks()
    app = FastAPI()
    app.include_router(transcripts_api.router, prefix="/api/v1")
    app.dependency_overrides[transcripts_api.get_job_repository] = lambda: _FakeJobRepository(
        language
    )
    app.dependency_overrides[transcripts_api.get_llm_task_repository] = lambda: tasks
    app.dependency_overrides[transcripts_api.get_settings] = lambda: settings
    sign_in(app)
    return TestClient(app, headers=REQUEST_HEADERS), tasks, settings


def _run_translation(settings, language="en", translator=None):
    """Run the translation as the background worker does; returns the task."""
    tasks = _FakeTasks()
    task = asyncio.run(tasks.enqueue(JOB["uuid"], "translation", None, "ana"))
    runner = llm_tasks.LlmTaskRunner(settings, tasks, _FakeJobRepository(language),
                                     translator or _FakeTranslator())
    asyncio.run(runner.run(task))
    return task


def test_portuguese_transcript_is_returned_unchanged(tmp_path):
    client, tasks, settings = _client(tmp_path, "pt")

    response = client.post(TRANSLATE_URL)

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "original"
    assert body["segments"] == SEGMENTS
    assert tasks.tasks == []
    assert not Path(settings.translation_dir).exists()


def test_asking_for_a_translation_queues_one_task(tmp_path):
    client, tasks, _ = _client(tmp_path, "en")

    first = client.post(TRANSLATE_URL, json={"target_language": "pt"})
    again = client.post(TRANSLATE_URL)

    assert first.status_code == 202
    assert first.json()["status"] == "queued"
    assert first.json()["segments"] == []
    assert first.json()["total"] == 1
    assert first.json()["task"]["kind"] == "translation"
    assert again.json()["task"]["id"] == first.json()["task"]["id"]  # not queued twice
    assert len(tasks.tasks) == 1
    assert tasks.tasks[0]["requested_by"]

    polled = client.get(TRANSLATION_URL).json()
    assert (polled["status"], polled["task"]["id"]) == ("queued", first.json()["task"]["id"])


def test_the_task_translates_and_the_translation_is_then_served(tmp_path):
    client, tasks, settings = _client(tmp_path, "en")
    client.post(TRANSLATE_URL)
    runner = llm_tasks.LlmTaskRunner(settings, tasks, _FakeJobRepository("en"), _FakeTranslator())
    asyncio.run(runner.run(tasks.tasks[0]))

    assert tasks.tasks[0]["status"] == "done"
    polled = client.get(TRANSLATION_URL).json()
    assert polled["status"] == "cached"
    assert polled["target_language"] == "pt-PT"
    assert polled["segments"][0]["text"] == "Bom dia"
    assert polled["task"] is None
    served = client.post(TRANSLATE_URL)
    assert (served.status_code, served.json()["status"]) == (200, "cached")
    assert len(tasks.tasks) == 1


def test_nothing_asked_yet_reads_as_none(tmp_path):
    client, _, _ = _client(tmp_path, "en")
    polled = client.get(TRANSLATION_URL).json()
    assert (polled["status"], polled["task"], polled["segments"]) == ("none", None, [])


def test_translation_ignores_a_cache_from_before_european_portuguese(tmp_path):
    client, _, settings = _client(tmp_path, "en")
    Path(settings.translation_dir).mkdir()
    (Path(settings.translation_dir) / "call.pt.json").write_text(
        json.dumps([{**SEGMENTS[0], "text": "Bom dia (Brasil)"}]), encoding="utf-8"
    )

    assert client.post(TRANSLATE_URL).status_code == 202


def test_translation_to_another_language_is_rejected(tmp_path):
    client, tasks, _ = _client(tmp_path, "en")

    response = client.post(TRANSLATE_URL, json={"target_language": "en"})

    assert response.status_code == 422
    assert tasks.tasks == []


def test_whole_transcript_is_sent_to_the_llm_in_small_blocks(tmp_path):
    settings = _settings(tmp_path, _numbered_segments(40))
    translator = _FakeTranslator()

    task = _run_translation(settings, translator=translator)

    assert translator.block_sizes == [15, 15, 10]
    assert (task["status"], task["progress_done"], task["progress_total"]) == ("done", 40, 40)
    cached = json.loads((Path(settings.translation_dir) / "call.pt-PT.json").read_text())
    assert [s["text"] for s in cached] == [f"PT: line {i}" for i in range(40)]
    assert cached[15]["start"] == 15.0  # timing and speaker are kept
    assert not (Path(settings.translation_dir) / "call.pt-PT.partial.json").exists()


def test_a_failed_task_resumes_from_the_blocks_already_translated(tmp_path):
    settings = _settings(tmp_path, _numbered_segments(40))

    failed = _run_translation(settings, translator=_FakeTranslator(fail_on_call=2))
    assert (failed["status"], failed["error_code"]) == ("error", "unavailable")
    assert failed["error"] == "LLM timed out"
    assert failed["progress_done"] == 15

    retry = _FakeTranslator()
    assert _run_translation(settings, translator=retry)["status"] == "done"
    # Only the 25 segments after the first (saved) block go back to the LLM.
    assert retry.block_sizes == [15, 10]


def test_an_edited_transcript_starts_the_translation_over(tmp_path):
    settings = _settings(tmp_path, _numbered_segments(20))
    transcript = Path(settings.transcript_dir) / "call.json"

    def edit_once(call):
        if call == 1:  # the user edits the transcript while block 1 is out
            edited = _numbered_segments(20)
            edited[0]["text"] = "edited line"
            transcript.write_text(json.dumps(edited), encoding="utf-8")

    translator = _FakeTranslator(on_call=edit_once)
    task = _run_translation(settings, translator=translator)

    assert task["status"] == "done"
    cached = json.loads((Path(settings.translation_dir) / "call.pt-PT.json").read_text())
    assert cached[0]["text"] == "PT: edited line"  # nothing stale was kept
    # The stale first block was dropped and sent again with the new text.
    assert translator.block_sizes == [15, 15, 5]


def test_llm_failures_get_a_code_the_page_can_explain():
    timeout = HTTPException(status_code=503, detail="slow")
    timeout.__cause__ = httpx.ReadTimeout("")
    assert llm_tasks.classify_error(timeout) == ("timeout", "slow")
    assert llm_tasks.classify_error(HTTPException(status_code=503, detail="down"))[0] == (
        "unavailable"
    )
    assert llm_tasks.classify_error(HTTPException(status_code=502, detail="bad"))[0] == "unusable"
    assert llm_tasks.classify_error(RuntimeError("boom")) == ("internal", "boom")


def test_translation_timeout_explains_what_to_change():
    class _TimeoutClient:
        async def post(self, *args, **kwargs):
            raise httpx.ReadTimeout("")

    service = SummaryService(_TimeoutClient(), _fake_settings(llm_timeout=180.0))

    with pytest.raises(HTTPException) as excinfo:
        asyncio.run(service.translate_segments([{"speaker": "A", "text": "Good morning"}]))

    assert excinfo.value.status_code == 503
    assert excinfo.value.detail == (
        "Translation service unavailable: The language model did not respond within "
        "180 seconds. Increase LLM_TIMEOUT if it needs more time."
    )
