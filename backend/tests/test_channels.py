"""
Stereo calls with one speaker per channel: telling them apart from mono saved
as stereo, merging the channels' transcripts (speakers, time order, a
language per channel) and the diarization that follows from the channels.
"""
import wave

import numpy as np
import pytest
from utils.channels import (
    analyze_channels,
    channel_diarization,
    merge_channels,
    read_wav_samples,
)

RNG = np.random.default_rng(7)


def _speech(n=16000):
    return (RNG.standard_normal(n) * 3000).astype(np.int16)


def test_two_different_sides_are_split():
    left, right = _speech(), _speech()
    right[: len(right) // 2] = 0  # one side quiet half of the time, like a real call
    result = analyze_channels(np.stack([left, right], axis=1))
    assert result["mode"] == "split"
    assert result["correlation"] < 0.2
    assert result["reason"] == "one speaker per channel"


def test_some_echo_of_the_other_side_still_splits():
    left, right = _speech(), _speech()
    right = (right + left * 0.2).astype(np.int16)  # crosstalk
    assert analyze_channels(np.stack([left, right], axis=1))["mode"] == "split"


def test_mono_saved_as_stereo_is_not_split():
    voice = _speech()
    result = analyze_channels(np.stack([voice, voice], axis=1))
    assert result["mode"] == "mono"
    assert result["correlation"] == pytest.approx(1.0)
    assert result["reason"] == "both channels carry the same signal"


def test_a_silent_channel_is_not_split():
    voice = _speech()
    result = analyze_channels(np.stack([voice, np.zeros_like(voice)], axis=1))
    assert result["mode"] == "mono"
    assert result["reason"] == "one channel is silent"


def test_mono_and_silent_recordings_are_not_split():
    assert analyze_channels(_speech().reshape(-1, 1))["reason"] == "not stereo"
    assert analyze_channels(np.zeros((100, 2), dtype=np.int16))["reason"] == "silent"


def test_wav_samples_are_read_per_channel(tmp_path):
    path = str(tmp_path / "s.wav")
    frames = np.array([[1, -1], [2, -2], [3, -3], [4, -4]], dtype="<i2")
    with wave.open(path, "wb") as wav:
        wav.setnchannels(2)
        wav.setsampwidth(2)
        wav.setframerate(8000)
        wav.writeframes(frames.tobytes())
    assert read_wav_samples(path).tolist() == frames.tolist()
    assert read_wav_samples(path, step=2).tolist() == [[1, -1], [3, -3]]


def _part(segments, language, probability, flags=(), duration=20.0, forced=False):
    detection = {"forced": True} if forced else {
        "language": language, "probability": probability, "flags": list(flags)}
    return {
        "segments": [{"id": i, "start": s, "end": e, "text": t}
                     for i, (s, e, t) in enumerate(segments)],
        "removed_segments": [{"text": " Obrigado por assistir."}],
        "language": language,
        "language_probability": None if forced else probability,
        "language_detection": detection,
        "duration": duration,
        "model_name": "large-v3",
        "settings": {"beam_size": 5},
    }


def test_the_channels_are_merged_in_time_order_with_their_speakers():
    left = _part([(0.0, 3.0, " Estou?"), (6.0, 9.0, " Sim, amanhã.")], "pt", 0.97)
    right = _part([(3.5, 5.5, " Bună ziua."), (6.0, 7.0, " Da.")], "ro", 0.91,
                  flags=["uncertain"], duration=21.0)

    merged = merge_channels([left, right])

    assert [(s["start"], s["speaker"], s["text"]) for s in merged["segments"]] == [
        (0.0, "SPEAKER_00", " Estou?"), (3.5, "SPEAKER_01", " Bună ziua."),
        (6.0, "SPEAKER_00", " Sim, amanhã."), (6.0, "SPEAKER_01", " Da."),
    ]
    assert [s["id"] for s in merged["segments"]] == [1, 2, 3, 4]
    assert [s["channel"] for s in merged["segments"]] == [0, 1, 0, 1]
    assert merged["text"] == " Estou? Bună ziua. Sim, amanhã. Da."
    # The language of the side with more speech leads; each side keeps its own.
    assert (merged["language"], merged["language_probability"]) == ("pt", 0.97)
    channels = merged["language_detection"]["channels"]
    assert [(c["speaker"], c["language"], c["probability"], c["flags"]) for c in channels] == [
        ("SPEAKER_00", "pt", 0.97, []), ("SPEAKER_01", "ro", 0.91, ["uncertain"])]
    assert [c["speech_seconds"] for c in channels] == [6.0, 3.0]
    assert merged["duration"] == 21.0
    assert [r["channel"] for r in merged["removed_segments"]] == [0, 1]
    assert merged["model_name"] == "large-v3"


def test_a_given_language_is_marked_forced_on_each_channel():
    merged = merge_channels([_part([(0, 1, " a")], "pt", None, forced=True),
                             _part([], "pt", None, forced=True)])
    assert [c["forced"] for c in merged["language_detection"]["channels"]] == [True, True]
    assert merged["language_detection"]["forced"] is True


def test_the_channels_are_the_diarization():
    merged = merge_channels([_part([(0.0, 3.0, " Estou?")], "pt", 0.9),
                             _part([(3.5, 5.5, " Sim.")], "pt", 0.9)])
    assert channel_diarization(merged) == {"model": "channels", "segments": [
        {"start": 0.0, "end": 3.0, "speaker": "SPEAKER_00"},
        {"start": 3.5, "end": 5.5, "speaker": "SPEAKER_01"},
    ]}
