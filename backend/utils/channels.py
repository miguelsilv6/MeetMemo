"""
Whether a stereo recording has one speaker per channel.

Call recorders usually put each side of the call on its own channel. Mixing
the channels into mono before transcribing then throws that information away:
overlapping speech is blended, the quieter side is drowned out, and speaker
diarization has to guess who speaks when the channel already says so. A
recording is transcribed channel by channel ("split") when its two channels
carry different signals; mono audio saved as stereo (two near-identical
channels) or a stereo file with one silent channel stays on the mono path.
"""
import wave

import numpy as np

# Channels this alike are the same signal (mono saved as two channels). Phone
# recordings with one side per channel stay far below it even with some
# echo/crosstalk of the other side.
SAME_SIGNAL_CORRELATION = 0.95
# A channel this much quieter than the other carries nothing to transcribe.
SILENT_CHANNEL_DB = -40.0


def analyze_channels(samples: np.ndarray) -> dict:
    """
    Decide how to transcribe a recording from its samples (frames x channels).

    Returns ``{"mode": "split" | "mono", "channels", "correlation",
    "level_ratio_db", "reason"}``; the numbers are kept with the transcript so
    the decision can be checked later.
    """
    channels = samples.shape[1] if samples.ndim == 2 else 1
    result = {"mode": "mono", "channels": channels, "correlation": None,
              "level_ratio_db": None, "reason": ""}
    if channels != 2 or len(samples) == 0:
        result["reason"] = "not stereo" if channels != 2 else "empty"
        return result

    left = samples[:, 0].astype(np.float64)
    right = samples[:, 1].astype(np.float64)
    rms = [float(np.sqrt(np.mean(ch * ch))) for ch in (left, right)]
    if max(rms) == 0:
        result["reason"] = "silent"
        return result
    ratio_db = 20 * np.log10(max(min(rms), 1e-12) / max(rms))
    result["level_ratio_db"] = round(float(ratio_db), 1)

    left -= left.mean()
    right -= right.mean()
    denominator = float(np.sqrt(np.sum(left * left) * np.sum(right * right)))
    correlation = float(np.sum(left * right) / denominator) if denominator else 1.0
    result["correlation"] = round(abs(correlation), 4)

    if ratio_db < SILENT_CHANNEL_DB:
        result["reason"] = "one channel is silent"
    elif abs(correlation) > SAME_SIGNAL_CORRELATION:
        result["reason"] = "both channels carry the same signal"
    else:
        result["mode"] = "split"
        result["reason"] = "one speaker per channel"
    return result


def read_wav_samples(path: str, step: int = 1) -> np.ndarray:
    """
    The frames of a 16-bit PCM WAV as an int16 array (frames x channels),
    keeping every ``step``-th frame (enough to compare channels, at a fraction
    of the memory).
    """
    with wave.open(path, "rb") as wav:
        if wav.getsampwidth() != 2:
            raise ValueError("expected 16-bit PCM")
        channels = wav.getnchannels()
        data = np.frombuffer(wav.readframes(wav.getnframes()), dtype="<i2")
    return data.reshape(-1, channels)[::step]


def channel_speaker(channel: int) -> str:
    """The speaker label of a channel (channel 0, the left, is SPEAKER_00)."""
    return f"SPEAKER_{channel:02d}"


def merge_channels(parts: list[dict]) -> dict:
    """
    One transcript from the transcripts of each channel.

    Every segment gets its channel's speaker, and the segments are put in
    time order. Each channel keeps its own language: the transcript's
    language is the one of the channel with the most speech, and the
    ``language_detection`` lists every channel's.
    """
    segments = sorted(
        ({**segment, "channel": n, "speaker": channel_speaker(n)}
         for n, part in enumerate(parts) for segment in part["segments"]),
        key=lambda segment: (segment["start"], segment["channel"]),
    )
    for index, segment in enumerate(segments, start=1):
        segment["id"] = index
    speech = [sum(s["end"] - s["start"] for s in part["segments"]) for part in parts]
    main = max(range(len(parts)), key=lambda n: speech[n])

    channels = []
    for n, part in enumerate(parts):
        detection = part.get("language_detection") or {}
        channels.append({
            "channel": n,
            "speaker": channel_speaker(n),
            "language": part["language"],
            "probability": part["language_probability"],
            "flags": detection.get("flags", []),
            "forced": bool(detection.get("forced")),
            "speech_seconds": round(speech[n], 1),
        })
    detection = {**(parts[main].get("language_detection") or {}), "channels": channels}

    return {
        "text": "".join(segment["text"] for segment in segments),
        "segments": segments,
        "language": parts[main]["language"],
        "language_probability": parts[main]["language_probability"],
        "language_detection": detection,
        "duration": max((part.get("duration") or 0) for part in parts),
        "removed_segments": [
            {**segment, "channel": n}
            for n, part in enumerate(parts) for segment in part["removed_segments"]
        ],
        "model_name": parts[0]["model_name"],
        "settings": parts[0]["settings"],
    }


def channel_diarization(transcription: dict) -> dict:
    """The diarization of a recording transcribed channel by channel: its segments' speakers."""
    return {
        "model": "channels",
        "segments": [
            {"start": s["start"], "end": s["end"], "speaker": s["speaker"]}
            for s in transcription.get("segments", [])
        ],
    }
