"""
The channel decision is made once per job and reused (a re-transcription or
the diarization step does not redo it), and a failure falls back to the mixed
audio instead of failing the job.
"""
import asyncio
import json
import subprocess
from types import SimpleNamespace

from services import audio_service as audio_module
from services.audio_service import AudioService


def _service(tmp_path):
    return AudioService(SimpleNamespace(upload_dir=str(tmp_path)), job_repo=None,
                        runtime_settings=object())


def test_the_decision_is_made_once_and_reused(monkeypatch, tmp_path):
    calls = []

    def prepare(source, paths, analysis_path, highpass, loudnorm):
        calls.append((source, highpass, loudnorm))
        for path in paths:
            open(path, "wb").close()
        analysis = {"mode": "split", "reason": "one speaker per channel", "paths": paths}
        with open(analysis_path, "w", encoding="utf-8") as f:
            json.dump(analysis, f)
        return analysis

    monkeypatch.setattr(audio_module, "prepare_channel_asr_audio", prepare)
    (tmp_path / "asr").mkdir()
    service = _service(tmp_path)

    first = asyncio.run(service.ensure_channel_audio("job", "call.wav", True, False))
    again = asyncio.run(service.ensure_channel_audio("job", "call.wav", True, False))

    assert calls == [("call.wav", True, False)]
    assert first == again and first["mode"] == "split"
    assert again["paths"] == [str(tmp_path / "asr" / "job.ch0.wav"),
                              str(tmp_path / "asr" / "job.ch1.wav")]

    # A split decision whose derivatives are gone is made again.
    (tmp_path / "asr" / "job.ch1.wav").unlink()
    asyncio.run(service.ensure_channel_audio("job", "call.wav"))
    assert len(calls) == 2


def test_a_failure_falls_back_to_the_mixed_audio(monkeypatch, tmp_path):
    def broken(*_args):
        raise subprocess.CalledProcessError(1, ["ffmpeg"], stderr=b"Invalid data")

    monkeypatch.setattr(audio_module, "prepare_channel_asr_audio", broken)
    assert asyncio.run(_service(tmp_path).ensure_channel_audio("job", "call.wav")) is None
