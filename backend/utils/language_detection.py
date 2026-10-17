"""
Language identification over the whole recording, not just its start.

faster-whisper detects the language from the first 30 seconds of speech
only, so a short greeting, an operator message or a ringback tone at the
start decides the language of the whole call. Here the speech found by the
VAD is sampled in up to N windows of 30 seconds spread from the start to the
end, Whisper's language distribution is computed for each window, and the
distributions are averaged (weighted by the speech in each window).

What was found is kept with the transcript: the top candidates, the result
of each window, and flags for a reviewer when the evidence is weak or
inconsistent. Whisper cannot tell European from Brazilian Portuguese, and
does not know Cape Verdean or Guinean creole; those usually show up as a
low-probability Portuguese, which ``possibly_unsupported`` points out.
"""
from typing import Optional

SAMPLE_RATE = 16000
WINDOW_SAMPLES = 30 * SAMPLE_RATE  # Whisper's input length

TOP_CANDIDATES = 3
# A window this sure of a different language is evidence of a second language.
MIXED_WINDOW_PROBABILITY = 0.7
# Below this the chosen language is a guess worth checking.
UNCERTAIN_PROBABILITY = 0.6
# When no window reaches this, the language may be one Whisper does not know.
UNSUPPORTED_WINDOW_PROBABILITY = 0.5

Spans = list[tuple[int, int]]


def speech_windows(speech: list[dict], count: int, window: int = WINDOW_SAMPLES) -> list[Spans]:
    """
    Up to ``count`` windows of ``window`` samples of speech, spread evenly over
    the speech from start to end.

    ``speech`` holds the VAD's speech chunks (``{"start", "end"}`` in samples).
    Each window is returned as the original-audio spans it is made of, since
    a window of speech can cross several chunks. Short recordings give fewer
    windows (one if all the speech fits in one), so no window repeats another.
    """
    chunks = [(int(c["start"]), int(c["end"])) for c in speech if c["end"] > c["start"]]
    total = sum(end - start for start, end in chunks)
    if total == 0 or count < 1:
        return []
    if total <= window:
        return [chunks]
    count = min(count, -(-total // window))  # no more windows than fit apart
    last_offset = total - window
    offsets = [round(i * last_offset / (count - 1)) for i in range(count)] if count > 1 else [0]
    return [_spans_at(chunks, offset, window) for offset in offsets]


def _spans_at(chunks: Spans, offset: int, length: int) -> Spans:
    """The original-audio spans covering ``length`` samples of speech from ``offset``."""
    spans: Spans = []
    position = 0  # in speech-only samples
    for start, end in chunks:
        size = end - start
        if position + size <= offset:
            position += size
            continue
        take_from = start + max(0, offset - position)
        take_to = min(end, take_from + length - sum(e - s for s, e in spans))
        spans.append((take_from, take_to))
        position += size
        if sum(e - s for s, e in spans) >= length:
            break
    return spans


def aggregate(windows: list[dict]) -> Optional[dict]:
    """
    Combine the per-window results into one decision.

    Each window: ``{"start", "end"}`` (seconds), ``"speech"`` (seconds of speech
    in it) and ``"probs"`` (Whisper's ``[(language, probability), ...]``).
    Returns None when there is nothing to decide from.
    """
    windows = [w for w in windows if w.get("probs")]
    if not windows:
        return None
    weights = [max(w.get("speech") or 0.0, 1e-6) for w in windows]
    total_weight = sum(weights)
    combined: dict[str, float] = {}
    for window, weight in zip(windows, weights):
        for language, probability in window["probs"]:
            combined[language] = combined.get(language, 0.0) + probability * weight / total_weight
    ranked = sorted(combined.items(), key=lambda item: item[1], reverse=True)
    language, probability = ranked[0]

    tops = [max(w["probs"], key=lambda item: item[1]) for w in windows]
    agreement = sum(weight for (top, _), weight in zip(tops, weights) if top == language)
    strong = {top for top, prob in tops if prob > MIXED_WINDOW_PROBABILITY}
    flags = []
    if len(strong) > 1:
        flags.append("mixed_languages")
    if probability < UNCERTAIN_PROBABILITY:
        flags.append("uncertain")
    if all(prob < UNSUPPORTED_WINDOW_PROBABILITY for _, prob in tops):
        flags.append("possibly_unsupported")

    return {
        "language": language,
        "probability": round(probability, 4),
        "candidates": [[lang, round(prob, 4)] for lang, prob in ranked[:TOP_CANDIDATES]],
        "windows": [
            {"start": round(w["start"], 2), "end": round(w["end"], 2),
             "language": top, "probability": round(prob, 4)}
            for w, (top, prob) in zip(windows, tops)
        ],
        "agreement": round(agreement / total_weight, 4),
        "flags": flags,
    }
