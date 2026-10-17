"""
The transcription step: a file is decoded and filtered without touching the
database (what the evaluation script uses), the language is detected over
windows spread across the recording and then imposed on the transcription,
and the pipeline step saves that same result with its progress and state.

faster-whisper is replaced by a fake: the test dependencies do not include it.
"""
import asyncio
import importlib
import sys
from types import ModuleType, SimpleNamespace

import numpy as np
import pytest
from runtime_settings import RuntimeSettings

SECONDS = 16000
PT = [("pt", 0.87), ("es", 0.08), ("gl", 0.05)]


class _FakeWhisper:
    calls = []
    detections = []  # what detect_language answers, window after window
    detected_chunks = []

    def __init__(self, name, **options):
        self.name = name
        self.options = options

    def detect_language(self, audio=None, **_options):
        _FakeWhisper.detected_chunks.append(len(audio))
        probs = _FakeWhisper.detections.pop(0) if _FakeWhisper.detections else PT
        return probs[0][0], probs[0][1], probs

    def transcribe(self, audio, language=None, **options):
        _FakeWhisper.calls.append((audio, language, options))
        segments = [
            SimpleNamespace(id=1, start=0.0, end=4.0, text=" Bom dia.", avg_logprob=-0.2,
                            no_speech_prob=0.01, compression_ratio=1.1,
                            words=[SimpleNamespace(start=0.0, end=1.2345, word=" Bom",
                                                   probability=0.98765),
                                   SimpleNamespace(start=1.2345, end=4.0, word=" dia.",
                                                   probability=0.41)]),
            SimpleNamespace(id=2, start=4.0, end=8.0, text=" Obrigado por assistir.",
                            avg_logprob=-0.3, no_speech_prob=0.1, compression_ratio=1.2,
                            words=None),
            SimpleNamespace(id=3, start=8.0, end=10.0, text=" hum", avg_logprob=-1.6,
                            no_speech_prob=0.2, compression_ratio=1.0, words=None),
        ]
        # faster-whisper reports a given language with probability 1.
        info = SimpleNamespace(language=language or "en",
                               language_probability=1.0 if language else 0.51, duration=10.0)
        return iter(segments), info


class _Fakes:
    audio_seconds = 10
    speech = None  # None: all of it
    decoded = []


@pytest.fixture(name="service_module")
def _service_module(monkeypatch):
    faster_whisper = ModuleType("faster_whisper")
    faster_whisper.WhisperModel = _FakeWhisper
    audio = ModuleType("faster_whisper.audio")
    def decode_audio(path, sampling_rate):
        _Fakes.decoded.append(path)
        return np.zeros(_Fakes.audio_seconds * SECONDS, dtype=np.float32)

    audio.decode_audio = decode_audio
    vad = ModuleType("faster_whisper.vad")
    vad.VadOptions = lambda **options: SimpleNamespace(**options)
    vad.get_speech_timestamps = lambda samples, options: (
        [{"start": 0, "end": len(samples)}] if _Fakes.speech is None else _Fakes.speech)
    for name, module in (("faster_whisper", faster_whisper), ("faster_whisper.audio", audio),
                         ("faster_whisper.vad", vad)):
        monkeypatch.setitem(sys.modules, name, module)
    monkeypatch.delitem(sys.modules, "services.transcription_service", raising=False)
    module = importlib.import_module("services.transcription_service")
    module._loaded_model = None  # pylint: disable=protected-access
    _FakeWhisper.calls, _FakeWhisper.detections, _FakeWhisper.detected_chunks = [], [], []
    _Fakes.audio_seconds, _Fakes.speech, _Fakes.decoded = 10, None, []
    yield module
    monkeypatch.delitem(sys.modules, "services.transcription_service", raising=False)


SETTINGS = SimpleNamespace(device="cpu", compute_type="int8", whisper_cpu_threads=2)


def _runtime(**changes):
    return RuntimeSettings(whisper_model_name="large-v3", **changes)


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
    # Each word's timing and probability is kept (word-level confidence).
    assert data["segments"][0]["words"] == [
        {"start": 0.0, "end": 1.23, "word": " Bom", "probability": 0.988},
        {"start": 1.23, "end": 4.0, "word": " dia.", "probability": 0.41}]
    assert data["segments"][1]["words"] == []
    audio, language, options = _FakeWhisper.calls[0]
    assert (len(audio), language, options["beam_size"]) == (10 * SECONDS, "pt", 5)


def test_the_language_is_detected_over_the_whole_call_and_imposed(service_module):
    # 90 s of speech: windows at the start, middle and end (3 fit apart).
    _Fakes.audio_seconds = 100
    _Fakes.speech = [{"start": 10 * SECONDS, "end": 100 * SECONDS}]
    # The greeting looks Spanish; the rest of the call is Portuguese.
    _FakeWhisper.detections = [[("es", 0.55), ("pt", 0.40)], [("pt", 0.95)], [("pt", 0.93)]]
    service = service_module.TranscriptionService(SETTINGS, job_repo=None)

    data = service.transcribe_file("call.wav", "large-v3", None, _runtime())

    detection = data["language_detection"]
    assert _FakeWhisper.detected_chunks == [30 * SECONDS] * 3
    assert [(w["start"], w["end"]) for w in detection["windows"]] == [
        (10.0, 40.0), (40.0, 70.0), (70.0, 100.0)]
    assert detection["language"] == "pt" and detection["candidates"][0][0] == "pt"
    assert _FakeWhisper.calls[0][1] == "pt"  # not faster-whisper's first-30-s guess
    assert data["language"] == "pt"
    assert data["language_probability"] == detection["probability"]


def test_two_languages_in_one_call_are_flagged(service_module):
    _Fakes.audio_seconds = 120
    _FakeWhisper.detections = [[("pt", 0.95)], [("ro", 0.91)], [("pt", 0.9)], [("ro", 0.88)]]
    service = service_module.TranscriptionService(SETTINGS, job_repo=None)

    data = service.transcribe_file("call.wav", "large-v3", None, _runtime())

    assert "mixed_languages" in data["language_detection"]["flags"]
    assert len(data["language_detection"]["windows"]) == 4


def test_the_number_of_windows_comes_from_the_admin_panel(service_module):
    _Fakes.audio_seconds = 300
    service = service_module.TranscriptionService(SETTINGS, job_repo=None)

    service.transcribe_file("call.wav", "large-v3", None,
                            _runtime(language_detection_windows=2))

    assert len(_FakeWhisper.detected_chunks) == 2


def test_a_given_language_is_not_reported_as_detected(service_module):
    service = service_module.TranscriptionService(SETTINGS, job_repo=None)

    data = service.transcribe_file("call.wav", "large-v3", "ro", _runtime())

    assert _FakeWhisper.detected_chunks == []
    assert _FakeWhisper.calls[0][1] == "ro"
    # faster-whisper says 1.0 for a given language: that is not a detection.
    assert (data["language"], data["language_probability"]) == ("ro", None)
    assert data["language_detection"] == {"forced": True}


def test_without_speech_faster_whispers_own_detection_is_kept(service_module):
    _Fakes.speech = []
    service = service_module.TranscriptionService(SETTINGS, job_repo=None)

    data = service.transcribe_file("call.wav", "large-v3", None, _runtime())

    assert _FakeWhisper.calls[0][1] is None
    assert (data["language"], data["language_probability"]) == ("en", 0.51)
    assert data["language_detection"] is None


def test_each_channel_is_transcribed_with_its_own_language(service_module):
    # Left side Portuguese, right side Romanian.
    _FakeWhisper.detections = [[("pt", 0.96)], [("ro", 0.9), ("pt", 0.05)]]
    progress = []
    service = service_module.TranscriptionService(SETTINGS, job_repo=None)

    data = service.transcribe_channels(["l.wav", "r.wav"], "large-v3", None, _runtime(),
                                       progress.append)

    assert _Fakes.decoded == ["l.wav", "r.wav"]
    assert [c[1] for c in _FakeWhisper.calls] == ["pt", "ro"]  # each side in its language
    assert [(s["start"], s["speaker"]) for s in data["segments"]] == [
        (0.0, "SPEAKER_00"), (0.0, "SPEAKER_01"), (8.0, "SPEAKER_00"), (8.0, "SPEAKER_01")]
    channels = data["language_detection"]["channels"]
    assert [(c["speaker"], c["language"]) for c in channels] == [
        ("SPEAKER_00", "pt"), ("SPEAKER_01", "ro")]
    # One progress bar over both channels.
    assert progress == [26, 42, 50, 66, 82, 90]


def test_the_pipeline_step_records_how_the_channels_were_used(service_module):
    repo = _JobRepo()
    service = service_module.TranscriptionService(SETTINGS, repo)
    split = {"mode": "split", "reason": "one speaker per channel", "correlation": 0.02,
             "paths": ["/srv/asr/j.ch0.wav", "/srv/asr/j.ch1.wav"]}

    split_data = asyncio.run(service.transcribe("job", "call.wav", "large-v3", None, _runtime(),
                                                split))
    mono_data = asyncio.run(service.transcribe("job", "call.wav", "large-v3", None, _runtime(),
                                               {"mode": "mono", "reason": "silent"}))
    plain = asyncio.run(service.transcribe("job", "call.wav", "large-v3", None, _runtime()))

    assert split_data["channel_mode"] == "split"
    assert {s["speaker"] for s in split_data["segments"]} == {"SPEAKER_00", "SPEAKER_01"}
    # The decision is kept for review, not the server's file paths.
    assert split_data["channel_analysis"] == {
        "mode": "split", "reason": "one speaker per channel", "correlation": 0.02}
    assert (mono_data["channel_mode"], mono_data["channel_analysis"]["reason"]) == ("mono",
                                                                                    "silent")
    assert "speaker" not in mono_data["segments"][0]
    assert plain["channel_mode"] == "mono" and "channel_analysis" not in plain


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
    assert data["language_detection"]["language"] == "pt"
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
    monkeypatch.setattr(evaluate_asr, "prepare_channel_asr_audio",
                        lambda src, paths, analysis, highpass, loudnorm: {"mode": "mono"})
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
    assert evaluate_asr.main([str(tmp_path / "missing"), "--defaults"]) == 2


def test_the_evaluation_script_checks_each_channels_language(service_module, monkeypatch,
                                                              tmp_path):
    # pylint: disable=import-outside-toplevel
    from scripts import evaluate_asr

    monkeypatch.setattr(evaluate_asr, "get_settings", lambda: SimpleNamespace(
        **vars(SETTINGS), whisper_model_name="large-v3", job_retention_hours=12,
        max_file_size=100 * 1024 * 1024, pyannote_model_name=None))
    monkeypatch.setattr(evaluate_asr, "prepare_channel_asr_audio",
                        lambda src, paths, analysis, highpass, loudnorm: {"mode": "split",
                                                                          "paths": paths})
    _FakeWhisper.detections = [[("pt", 0.96)], [("ro", 0.9)]]
    bench = tmp_path / "bench"
    bench.mkdir()
    (bench / "call.wav").write_bytes(b"RIFF")
    (bench / "call.lang").write_text("pt ro", encoding="utf-8")

    assert evaluate_asr.main([str(bench), "--defaults", "--out", str(tmp_path / "out")]) == 0

    report = (tmp_path / "out" / "report.md").read_text(encoding="utf-8")
    assert "| pt ro | pt / ro | ✓ |" in report
    assert report.rstrip().endswith("| split |")
    assert [path.rsplit("/", 1)[-1] for path in _Fakes.decoded] == ["ch0.wav", "ch1.wav"]
