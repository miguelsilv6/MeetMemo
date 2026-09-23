"""
Waveform peak extraction utilities.

This module computes a downsampled min/max peak envelope for a time range
of an audio file, used to render a waveform scrubber in the transcript
split-segment UI.
"""
import numpy as np
from pydub import AudioSegment


def compute_waveform_peaks(
    file_path: str,
    start: float,
    end: float,
    buckets: int = 100
) -> list[dict]:
    """
    Compute min/max peak pairs for a time range of an audio file.

    The audio slice is downmixed to mono, normalized to [-1, 1], and split
    into `buckets` equal-width chunks, each reduced to its min and max
    sample value — enough to draw a waveform without shipping raw PCM.

    Args:
        file_path: Path to the audio file on disk
        start: Range start in seconds
        end: Range end in seconds
        buckets: Number of peak pairs to produce

    Returns:
        List of {"min": float, "max": float} dicts, each in [-1, 1].
        Empty if the range is empty or invalid.

    Example:
        >>> peaks = compute_waveform_peaks("meeting.wav", 12.5, 15.0, buckets=50)
        >>> len(peaks) <= 50
        True
    """
    audio = AudioSegment.from_file(file_path)

    start_ms = max(0, int(start * 1000))
    end_ms = min(len(audio), int(end * 1000))
    if end_ms <= start_ms:
        return []

    clip = audio[start_ms:end_ms]
    samples = np.array(clip.get_array_of_samples())
    if samples.size == 0:
        return []

    if clip.channels > 1:
        samples = samples.reshape((-1, clip.channels)).mean(axis=1)

    max_amplitude = float(1 << (8 * clip.sample_width - 1))
    normalized = samples.astype(np.float32) / max_amplitude

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
