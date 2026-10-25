"""
Segments cut where the speaker pauses.

With the VAD filter, faster-whisper transcribes the speech stretches back to
back and only then restores each word's original time, so a segment can hold
"Sim." and, 20 seconds later, "Está bem.": its start and end then cover the
whole pause, which on a call transcribed per channel is the other side
speaking. Cutting the segment where two words are far apart gives each part
the time it was actually spoken.
"""

# Within a sentence Whisper rarely leaves more than a second between words.
MAX_WORD_GAP_SECONDS = 2.0


def split_at_pauses(segment: dict, max_gap: float = MAX_WORD_GAP_SECONDS) -> list[dict]:
    """
    The parts of a segment between pauses longer than ``max_gap`` seconds.

    Each part keeps the segment's other fields (its decoding metrics) with
    its own words, times and text. A segment without words, or without such
    a pause, is returned as it is.
    """
    words = segment.get("words") or []
    groups = [[words[0]]] if words else []
    for previous, word in zip(words, words[1:]):
        if word["start"] - previous["end"] > max_gap:
            groups.append([])
        groups[-1].append(word)
    if len(groups) <= 1:
        return [segment]
    return [
        {**segment, "start": group[0]["start"], "end": group[-1]["end"],
         "text": "".join(w["word"] for w in group), "words": group}
        for group in groups
    ]


def split_segments_at_pauses(segments: list[dict]) -> list[dict]:
    """Every segment cut at its pauses, renumbered from 1."""
    parts = [part for segment in segments for part in split_at_pauses(segment)]
    for index, part in enumerate(parts, start=1):
        part["id"] = index
    return parts
