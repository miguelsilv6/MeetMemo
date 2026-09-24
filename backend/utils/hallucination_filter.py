"""
Post-transcription hallucination handling.

Whisper was trained on subtitled video, so over silence or noise it tends to
emit subtitle credits and video sign-offs ("Legendas pela comunidade
Amara.org", "Obrigado por assistir"). Those are removed only when they make up
the *whole* segment, since they never occur in a real call that way. Every
other doubtful segment is kept but flagged ``low_confidence`` for human
review against the audio: in an evidential context it is safer to surface a
doubtful line than to silently drop what may be real speech.
"""
import re
import unicodedata

# Thresholds mirror the decoder's own quality gates (log_prob_threshold,
# no_speech_threshold, compression_ratio_threshold): a segment that still
# crosses one after temperature fallback is worth a second look.
LOW_AVG_LOGPROB = -1.0
HIGH_NO_SPEECH_PROB = 0.6
HIGH_COMPRESSION_RATIO = 2.4

_KNOWN_HALLUCINATIONS = {
    "obrigado por assistir",
    "obrigada por assistir",
    "obrigado por assistirem",
    "obrigada por assistirem",
    "obrigado por terem assistido",
    "inscrevase no canal",
    "inscrevamse no canal",
    "nao se esqueca de se inscrever no canal",
    "thanks for watching",
    "thank you for watching",
    "thank you so much for watching",
    "please subscribe",
    "like and subscribe",
}

# Subtitle/translation credit lines, e.g. "Legendas por ...", "Legendado por
# ...", "Tradução e legendas: ...", "Subtitles by ...".
_CREDIT_PATTERN = re.compile(
    r"^(legendas?|legendado|legendagem|traducao e legendas|transcricao e legendas|"
    r"subtitles|subtitled|captions|captioned)\s+(pela|pelo|por|by)\b(?!\s+favor)"
)


def normalize_text(text: str) -> str:
    """Lowercase, strip accents and punctuation, and collapse whitespace."""
    decomposed = unicodedata.normalize("NFKD", text.lower())
    without_accents = "".join(c for c in decomposed if not unicodedata.combining(c))
    letters_only = re.sub(r"[^\w\s]", "", without_accents)
    return re.sub(r"\s+", " ", letters_only).strip()


def is_known_hallucination(text: str) -> bool:
    """True if the whole segment is a known Whisper subtitle/sign-off artifact."""
    normalized = normalize_text(text)
    if not normalized:
        return False
    if "amaraorg" in normalized.replace(" ", ""):
        return True
    if normalized in _KNOWN_HALLUCINATIONS:
        return True
    return bool(_CREDIT_PATTERN.match(normalized))


def is_low_confidence(segment: dict) -> bool:
    """True if the decoder's own quality signals mark the segment as doubtful."""
    avg_logprob = segment.get("avg_logprob")
    no_speech_prob = segment.get("no_speech_prob")
    compression_ratio = segment.get("compression_ratio")
    return (
        (avg_logprob is not None and avg_logprob < LOW_AVG_LOGPROB)
        or (no_speech_prob is not None and no_speech_prob > HIGH_NO_SPEECH_PROB)
        or (compression_ratio is not None and compression_ratio > HIGH_COMPRESSION_RATIO)
    )


def filter_segments(segments: list[dict]) -> tuple[list[dict], list[dict]]:
    """
    Split segments into those to keep and those removed as hallucinations.

    Kept segments get a boolean ``low_confidence`` flag. Removed segments carry
    a ``removed_reason`` so the removal stays auditable.
    """
    kept: list[dict] = []
    removed: list[dict] = []
    for segment in segments:
        text = (segment.get("text") or "").strip()
        if not normalize_text(text):
            removed.append({**segment, "removed_reason": "empty"})
        elif is_known_hallucination(text):
            removed.append({**segment, "removed_reason": "known_hallucination"})
        else:
            kept.append({**segment, "low_confidence": is_low_confidence(segment)})
    return kept, removed
