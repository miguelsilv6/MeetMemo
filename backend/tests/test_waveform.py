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
