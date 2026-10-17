"""
The transcription step: a file is decoded and filtered without touching the
database (what the evaluation script uses), and the pipeline step saves that
same result with its progress and state.

faster-whisper is replaced by a fake: the test dependencies do not include it.
"""
import asyncio
import importlib
import sys
from types import ModuleType, SimpleNamespace

import pytest
from runtime_settings import RuntimeSettings


class _FakeWhisper:
    calls = []

    def __init__(self, name, **options):
        self.name = name
        self.options = options

    def transcribe(self, path, language=None, **options):
        _FakeWhisper.calls.append((path, language, options))
        segments = [
            SimpleNamespace(id=1, start=0.0, end=4.0, text=" Bom dia.", avg_logprob=-0.2,
                            no_speech_prob=0.01, compression_ratio=1.1),
            SimpleNamespace(id=2, start=4.0, end=8.0, text=" Obrigado por assistir.",
                            avg_logprob=-0.3, no_speech_prob=0.1, compression_ratio=1.2),
            SimpleNamespace(id=3, start=8.0, end=10.0, text=" hum", avg_logprob=-1.6,
                            no_speech_prob=0.2, compression_ratio=1.0),
        ]
        info = SimpleNamespace(language=language or "pt", language_probability=0.87,
                               duration=10.0)
        return iter(segments), info


@pytest.fixture(name="service_module")
def _service_module(monkeypatch):
    faster_whisper = ModuleType("faster_whisper")
    faster_whisper.WhisperModel = _FakeWhisper
    monkeypatch.setitem(sys.modules, "faster_whisper", faster_whisper)
    monkeypatch.delitem(sys.modules, "services.transcription_service", raising=False)
    module = importlib.import_module("services.transcription_service")
    module._loaded_model = None  # pylint: disable=protected-access
    _FakeWhisper.calls = []
    yield module
    monkeypatch.delitem(sys.modules, "services.transcription_service", raising=False)


SETTINGS = SimpleNamespace(device="cpu", compute_type="int8", whisper_cpu_threads=2)


def _runtime():
    return RuntimeSettings(whisper_model_name="large-v3")


def test_a_file_is_transcribed_and_filtered_without_the_database(service_module):
    progress = []
    service = service_module.TranscriptionService(SETTINGS, job_repo=None)

    data = service.transcribe_file("call.wav", "large-v3", None, _runtime(), progress.append)

    assert [s["text"] for s in data["segments"]] == [" Bom dia.", " hum"]
    assert [s["low_confidence"] for s in data["segments"]] == [False, True]
    assert data["removed_segments"][0]["removed_reason"] == "known_hallucination"
    assert (data["language"], data["language_probability"], data["duration"]) == ("pt", 0.87, 10.0)
    assert data["model_name"] == "large-v3"
    assert data["settings"]["beam_size"] == 5
    assert progress == [42, 74, 90]
    path, language, options = _FakeWhisper.calls[0]
    assert (path, language, options["beam_size"]) == ("call.wav", None, 5)


class _JobRepo:
    def __init__(self):
        self.saved = None
        self.states = []
        self.progress = []

    async def update_workflow_state(self, job_uuid, state, progress):
        self.states.append(state)

    async def update_step_progress(self, job_uuid, progress):
        self.progress.append(progress)

    async def save_transcription(self, job_uuid, data):
        self.saved = data


def test_the_pipeline_step_saves_the_same_result(service_module):
    repo = _JobRepo()
    service = service_module.TranscriptionService(SETTINGS, repo)

    async def run():
        data = await service.transcribe("job", "call.wav", "large-v3", None, _runtime())
        await asyncio.sleep(0)  # let the progress updates sent from the worker thread run
        return data

    data = asyncio.run(run())

    assert repo.saved == data
    assert [s["text"] for s in data["segments"]] == [" Bom dia.", " hum"]
    assert repo.states == ["transcribing", "transcribed"]
    assert repo.progress[0] == 10 and repo.progress[-1] == 100


def test_the_evaluation_script_writes_a_report(service_module, monkeypatch, tmp_path):
    # pylint: disable=import-outside-toplevel
    import shutil

    from scripts import evaluate_asr

    monkeypatch.setattr(evaluate_asr, "get_settings", lambda: SimpleNamespace(
        **vars(SETTINGS), whisper_model_name="large-v3", job_retention_hours=12,
        max_file_size=100 * 1024 * 1024, pyannote_model_name=None))
    monkeypatch.setattr(evaluate_asr, "prepare_asr_audio",
                        lambda src, dst, highpass, loudnorm: shutil.copy(src, dst))
    bench = tmp_path / "bench"
    bench.mkdir()
    (bench / "call.wav").write_bytes(b"RIFF")
    (bench / "call.txt").write_text("Bom dia, hum.", encoding="utf-8")
    (bench / "call.lang").write_text("pt", encoding="utf-8")
    out = tmp_path / "out"

    code = evaluate_asr.main([str(bench), "--defaults", "--model", "large-v3",
                              "--out", str(out)])

    assert code == 0
    report = (out / "report.md").read_text(encoding="utf-8")
    assert "- **Model:** large-v3" in report
    assert "| call.wav | 10.0s |" in report and "| pt | pt (87%) | ✓ | 0.0% |" in report
    assert (out / "transcripts" / "call.txt").read_text(encoding="utf-8") == "Bom dia. hum\n"
    assert "call.wav" in (out / "results.csv").read_text(encoding="utf-8")
    assert evaluate_asr.main([str(bench), "--defaults", "--model", "evil/repo"]) == 2
