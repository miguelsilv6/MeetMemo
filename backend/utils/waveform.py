"""
Waveform peak extraction utilities.

This module computes a downsampled min/max peak envelope for a time range
of an audio file, used to render the audio player's waveform (mixed or per
channel) and the split-segment scrubber.
"""
import numpy as np
from pydub import AudioSegment


def _bucket_peaks(normalized: np.ndarray, buckets: int) -> list[dict]:
    """Reduces normalized samples to at most `buckets` min/max pairs."""
    bucket_size = max(1, len(normalized) // buckets)
    peaks = []
    for i in range(0, len(normalized), bucket_size):
        chunk = normalized[i:i + bucket_size]
        if chunk.size == 0:
            continue
        peaks.append({"min": float(chunk.min()), "max": float(chunk.max())})
        if len(peaks) >= buckets:
            break
    return peaks


def compute_waveform(
    file_path: str,
    start: float,
    end: float,
    buckets: int = 100,
    split_channels: bool = False,
) -> dict:
    """
    Compute min/max peak pairs for a time range of an audio file.

    The slice is normalized to [-1, 1] and split into `buckets` equal-width
    chunks, each reduced to its min and max sample value — enough to draw a
    waveform without shipping raw PCM. `peaks` is always the downmixed
    (mono) envelope; with `split_channels`, `channel_peaks` also holds one
    envelope per channel, in channel order (left, right, ...).

    Args:
        file_path: Path to the audio file on disk
        start: Range start in seconds
        end: Range end in seconds
        buckets: Number of peak pairs to produce per envelope
        split_channels: Also compute one envelope per channel

    Returns:
        {"channels": int, "peaks": [...], "channel_peaks": [[...], ...]?}
        where each peak is {"min": float, "max": float} in [-1, 1]. The
        envelopes are empty if the range is empty or invalid.
    """
    audio = AudioSegment.from_file(file_path)
    channels = audio.channels
    result: dict = {"channels": channels, "peaks": []}
    if split_channels:
        result["channel_peaks"] = [[] for _ in range(channels)]

    start_ms = max(0, int(start * 1000))
    end_ms = min(len(audio), int(end * 1000))
    if end_ms <= start_ms:
        return result

    clip = audio[start_ms:end_ms]
    samples = np.array(clip.get_array_of_samples())
    if samples.size == 0:
        return result

    max_amplitude = float(1 << (8 * clip.sample_width - 1))
    frames = samples.reshape((-1, channels)).astype(np.float32) / max_amplitude

    result["peaks"] = _bucket_peaks(frames.mean(axis=1), buckets)
    if split_channels:
        result["channel_peaks"] = [
            _bucket_peaks(frames[:, channel], buckets) for channel in range(channels)
        ]
    return result


def compute_waveform_peaks(
    file_path: str,
    start: float,
    end: float,
    buckets: int = 100
) -> list[dict]:
    """
    The downmixed (mono) min/max peak envelope for a time range.

    Example:
        >>> peaks = compute_waveform_peaks("meeting.wav", 12.5, 15.0, buckets=50)
        >>> len(peaks) <= 50
        True
    """
    return compute_waveform(file_path, start, end, buckets)["peaks"]
