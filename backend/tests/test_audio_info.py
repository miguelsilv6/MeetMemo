"""The length of an uploaded WAV, read from its header."""
import wave

from utils.audio_info import wav_seconds


def test_reads_how_long_a_wav_plays(tmp_path):
    path = tmp_path / "call.wav"
    with wave.open(str(path), "wb") as wav:
        wav.setnchannels(2)
        wav.setsampwidth(2)
        wav.setframerate(16000)
        wav.writeframes(b"\0\0\0\0" * 16000 * 3)
    assert wav_seconds(str(path)) == 3.0


def test_has_no_length_for_what_it_cannot_read(tmp_path):
    broken = tmp_path / "broken.wav"
    broken.write_bytes(b"not a wav")
    assert wav_seconds(str(broken)) is None
    assert wav_seconds(str(tmp_path / "missing.wav")) is None
