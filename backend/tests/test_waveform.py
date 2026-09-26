"""Tests for waveform peak extraction."""
import math
import struct
import wave

import pytest

pytest.importorskip("pydub")
pytest.importorskip("numpy")

from utils.waveform import compute_waveform_peaks


def _write_sine_wav(path, duration_s=2.0, freq=440, sample_rate=8000, amplitude=16000):
    n_samples = int(duration_s * sample_rate)
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(sample_rate)
        frames = b"".join(
            struct.pack(
                "<h", int(amplitude * math.sin(2 * math.pi * freq * i / sample_rate))
            )
            for i in range(n_samples)
        )
        w.writeframes(frames)


def _write_silence_wav(path, duration_s=1.0, sample_rate=8000):
    n_samples = int(duration_s * sample_rate)
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(sample_rate)
        w.writeframes(b"\x00\x00" * n_samples)


def test_returns_requested_number_of_buckets(tmp_path):
    path = tmp_path / "tone.wav"
    _write_sine_wav(path, duration_s=2.0)

    peaks = compute_waveform_peaks(str(path), 0, 2.0, buckets=50)

    assert len(peaks) == 50


def test_peak_values_stay_within_normalized_range(tmp_path):
    path = tmp_path / "tone.wav"
    _write_sine_wav(path, duration_s=2.0)

    peaks = compute_waveform_peaks(str(path), 0, 2.0, buckets=20)

    for peak in peaks:
        assert -1.0 <= peak["min"] <= peak["max"] <= 1.0


def test_silence_produces_near_zero_peaks(tmp_path):
    path = tmp_path / "silence.wav"
    _write_silence_wav(path, duration_s=1.0)

    peaks = compute_waveform_peaks(str(path), 0, 1.0, buckets=10)

    assert all(abs(p["min"]) < 1e-6 and abs(p["max"]) < 1e-6 for p in peaks)


def test_extracts_only_the_requested_time_range(tmp_path):
    path = tmp_path / "half_silence_half_tone.wav"
    sample_rate = 8000
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(sample_rate)
        silence = b"\x00\x00" * sample_rate  # 1s of silence
        tone = b"".join(
            struct.pack("<h", int(16000 * math.sin(2 * math.pi * 440 * i / sample_rate)))
            for i in range(sample_rate)  # 1s of tone
        )
        w.writeframes(silence + tone)

    silent_range_peaks = compute_waveform_peaks(str(path), 0, 1.0, buckets=10)
    tone_range_peaks = compute_waveform_peaks(str(path), 1.0, 2.0, buckets=10)

    assert all(abs(p["max"]) < 1e-6 for p in silent_range_peaks)
    assert any(p["max"] > 0.1 for p in tone_range_peaks)


def test_returns_empty_list_for_an_empty_or_invalid_range(tmp_path):
    path = tmp_path / "tone.wav"
    _write_sine_wav(path, duration_s=1.0)

    assert compute_waveform_peaks(str(path), 0.5, 0.5, buckets=10) == []
    assert compute_waveform_peaks(str(path), 2.0, 3.0, buckets=10) == []


# --- Per-channel envelopes -------------------------------------------------------

def _write_stereo_wav(path, sample_rate=8000, duration_s=1.0):
    """Left: a loud 440 Hz tone. Right: silence."""
    frames = []
    for i in range(int(duration_s * sample_rate)):
        left = int(20000 * math.sin(2 * math.pi * 440 * i / sample_rate))
        frames.append(struct.pack("<hh", left, 0))
    with wave.open(str(path), "wb") as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(sample_rate)
        w.writeframes(b"".join(frames))


def test_split_channels_returns_one_envelope_per_channel(tmp_path):
    from utils.waveform import compute_waveform

    path = tmp_path / "stereo.wav"
    _write_stereo_wav(path)

    result = compute_waveform(str(path), 0, 1, buckets=10, split_channels=True)

    assert result["channels"] == 2
    left, right = result["channel_peaks"]
    assert len(left) == len(right) == 10
    assert max(p["max"] for p in left) > 0.5
    assert all(p["min"] == p["max"] == 0 for p in right)
    # The mixed envelope averages the channels: half the left channel's level.
    assert max(p["max"] for p in result["peaks"]) == pytest.approx(
        max(p["max"] for p in left) / 2, rel=0.01
    )


def test_channel_envelopes_are_only_computed_when_asked(tmp_path):
    from utils.waveform import compute_waveform

    path = tmp_path / "stereo.wav"
    _write_stereo_wav(path)

    result = compute_waveform(str(path), 0, 1, buckets=10)

    assert result["channels"] == 2
    assert "channel_peaks" not in result


def test_mono_file_reports_one_channel(tmp_path):
    from utils.waveform import compute_waveform

    path = tmp_path / "mono.wav"
    _write_sine_wav(path, duration_s=1.0)

    result = compute_waveform(str(path), 0, 1, buckets=5, split_channels=True)

    assert result["channels"] == 1
    assert len(result["channel_peaks"]) == 1
    assert result["channel_peaks"][0] == result["peaks"]


def test_waveform_endpoint_returns_channel_envelopes_on_request(tmp_path):
    import importlib.util
    from pathlib import Path
    from types import SimpleNamespace

    from fastapi import FastAPI
    from fastapi.testclient import TestClient

    spec = importlib.util.spec_from_file_location(
        "audio_api_under_test", Path(__file__).resolve().parents[1] / "api" / "v1" / "audio.py"
    )
    audio_api = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(audio_api)

    _write_stereo_wav(tmp_path / "call.wav")

    class FakeJobRepository:
        async def get(self, uuid):
            return {"uuid": uuid, "file_name": "call.wav"}

    app = FastAPI()
    app.include_router(audio_api.router, prefix="/api/v1")
    app.dependency_overrides[audio_api.get_job_repository] = FakeJobRepository
    app.dependency_overrides[audio_api.get_settings] = lambda: SimpleNamespace(
        upload_dir=str(tmp_path)
    )
    client = TestClient(app)
    url = "/api/v1/jobs/job1/waveform?start=0&end=1&buckets=4"

    mixed = client.get(url).json()
    split = client.get(url + "&split_channels=true").json()

    assert mixed["channels"] == 2 and len(mixed["peaks"]) == 4
    assert "channel_peaks" not in mixed
    assert [len(peaks) for peaks in split["channel_peaks"]] == [4, 4]
