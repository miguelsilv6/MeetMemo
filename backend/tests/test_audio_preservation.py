"""The stored recording keeps its original channels and sample rate."""
import wave

import numpy as np
from utils.file_utils import convert_to_wav


def _write_wav(path, rate, channels):
    """Writes 0.5 s of int16 audio, one distinct tone per channel."""
    t = np.arange(int(rate * 0.5)) / rate
    tones = [np.sin(2 * np.pi * (220 + 220 * c) * t) * (0.3 + 0.3 * c) for c in range(channels)]
    frames = (np.stack(tones, axis=1) * 32767).astype("<i2")
    with wave.open(str(path), "wb") as w:
        w.setnchannels(channels)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(frames.tobytes())
    return frames


def _read_wav(path):
    with wave.open(str(path)) as w:
        frames = np.frombuffer(w.readframes(w.getnframes()), dtype="<i2")
        return w.getnchannels(), w.getframerate(), frames.reshape(-1, w.getnchannels())


def test_stereo_recording_keeps_both_channels_and_its_sample_rate(tmp_path):
    source = _write_wav(tmp_path / "call.wav", 44100, 2)

    convert_to_wav(str(tmp_path / "call.wav"), str(tmp_path / "stored.wav"))

    channels, rate, stored = _read_wav(tmp_path / "stored.wav")
    assert channels == 2
    assert rate == 44100
    # Each channel is carried over sample for sample, not mixed together.
    np.testing.assert_array_equal(stored, source)


def test_telephone_rate_mono_recording_is_not_resampled(tmp_path):
    _write_wav(tmp_path / "call.wav", 8000, 1)

    convert_to_wav(str(tmp_path / "call.wav"), str(tmp_path / "stored.wav"))

    channels, rate, _ = _read_wav(tmp_path / "stored.wav")
    assert (channels, rate) == (1, 8000)
