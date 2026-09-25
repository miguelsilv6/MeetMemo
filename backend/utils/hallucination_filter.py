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
from dataclasses import dataclass

# Whole-segment phrases removed as hallucinations. Editable from the admin
# panel; matching ignores case, accents and punctuation.
DEFAULT_HALLUCINATION_PHRASES = (
    "Obrigado por assistir",
    "Obrigada por assistir",
    "Obrigado por assistirem",
    "Obrigada por assistirem",
    "Obrigado por terem assistido",
    "Inscreva-se no canal",
    "Inscrevam-se no canal",
    "Não se esqueça de se inscrever no canal",
    "Thanks for watching",
    "Thank you for watching",
    "Thank you so much for watching",
    "Please subscribe",
    "Like and subscribe",
)

# Built-in rules that always apply on top of the phrase list: any Amara.org
# credit, and subtitle/translation credit lines ("Legendas por ...",
# "Legendado por ...", "Tradução e legendas: ...", "Subtitles by ...").
_CREDIT_PATTERN = re.compile(
    r"^(legendas?|legendado|legendagem|traducao e legendas|transcricao e legendas|"
    r"subtitles|subtitled|captions|captioned)\s+(pela|pelo|por|by)\b(?!\s+favor)"
)


@dataclass(frozen=True)
class FilterRules:
    """Thresholds and phrases that drive the filter.

    The thresholds mirror the decoder's own quality gates (log_prob_threshold,
    no_speech_threshold, compression_ratio_threshold): a segment that still
    crosses one after temperature fallback is worth a second look.
    """

    avg_logprob: float = -1.0
    no_speech_prob: float = 0.6
    compression_ratio: float = 2.4
    phrases: tuple[str, ...] = DEFAULT_HALLUCINATION_PHRASES


def normalize_text(text: str) -> str:
    """Lowercase, strip accents and punctuation, and collapse whitespace."""
    decomposed = unicodedata.normalize("NFKD", text.lower())
    without_accents = "".join(c for c in decomposed if not unicodedata.combining(c))
    letters_only = re.sub(r"[^\w\s]", "", without_accents)
    return re.sub(r"\s+", " ", letters_only).strip()


def _normalized_phrases(phrases: tuple[str, ...]) -> frozenset[str]:
    return frozenset(p for p in (normalize_text(phrase) for phrase in phrases) if p)


def is_known_hallucination(
    text: str, phrases: tuple[str, ...] = DEFAULT_HALLUCINATION_PHRASES
) -> bool:
    """True if the whole segment is a known Whisper subtitle/sign-off artifact."""
    return _matches_hallucination(normalize_text(text), _normalized_phrases(phrases))


def _matches_hallucination(normalized: str, normalized_phrases: frozenset[str]) -> bool:
    if not normalized:
        return False
    if "amaraorg" in normalized.replace(" ", ""):
        return True
    if normalized in normalized_phrases:
        return True
    return bool(_CREDIT_PATTERN.match(normalized))


def is_low_confidence(segment: dict, rules: FilterRules = FilterRules()) -> bool:
    """True if the decoder's own quality signals mark the segment as doubtful."""
    avg_logprob = segment.get("avg_logprob")
    no_speech_prob = segment.get("no_speech_prob")
    compression_ratio = segment.get("compression_ratio")
    return (
        (avg_logprob is not None and avg_logprob < rules.avg_logprob)
        or (no_speech_prob is not None and no_speech_prob > rules.no_speech_prob)
        or (compression_ratio is not None and compression_ratio > rules.compression_ratio)
    )


def filter_segments(
    segments: list[dict], rules: FilterRules = FilterRules()
) -> tuple[list[dict], list[dict]]:
    """
    Split segments into those to keep and those removed as hallucinations.

    Kept segments get a boolean ``low_confidence`` flag. Removed segments carry
    a ``removed_reason`` so the removal stays auditable.
    """
    normalized_phrases = _normalized_phrases(rules.phrases)
    kept: list[dict] = []
    removed: list[dict] = []
    for segment in segments:
        normalized = normalize_text(segment.get("text") or "")
        if not normalized:
            removed.append({**segment, "removed_reason": "empty"})
        elif _matches_hallucination(normalized, normalized_phrases):
            removed.append({**segment, "removed_reason": "known_hallucination"})
        else:
            kept.append({**segment, "low_confidence": is_low_confidence(segment, rules)})
    return kept, removed
