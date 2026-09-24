"""
Runtime-tunable transcription settings, editable from the admin panel.

Defaults come from the environment/hardware profile (``config.Settings``) and
the code's own tuned constants; values saved from the panel override them and
take effect for new jobs without a restart. Settings that need a restart
(device, compute precision, diarization model) and secrets deliberately stay
in the environment only.
"""
import logging
from typing import Any, Optional

from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator, model_validator
from utils.hallucination_filter import DEFAULT_HALLUCINATION_PHRASES, FilterRules

logger = logging.getLogger(__name__)

# Whisper model names the panel may select. An allowlist matters: faster-whisper
# treats any other string as a Hugging Face repo id or local path to load.
WHISPER_MODELS = ("tiny", "base", "small", "medium", "large-v2", "large-v3", "turbo")

# Language codes accepted by faster-whisper 1.1.0 (faster_whisper.tokenizer).
WHISPER_LANGUAGE_CODES = frozenset({
    "af", "am", "ar", "as", "az", "ba", "be", "bg", "bn", "bo", "br", "bs", "ca", "cs",
    "cy", "da", "de", "el", "en", "es", "et", "eu", "fa", "fi", "fo", "fr", "gl", "gu",
    "ha", "haw", "he", "hi", "hr", "ht", "hu", "hy", "id", "is", "it", "ja", "jw", "ka",
    "kk", "km", "kn", "ko", "la", "lb", "ln", "lo", "lt", "lv", "mg", "mi", "mk", "ml",
    "mn", "mr", "ms", "mt", "my", "ne", "nl", "nn", "no", "oc", "pa", "pl", "ps", "pt",
    "ro", "ru", "sa", "sd", "si", "sk", "sl", "sn", "so", "sq", "sr", "su", "sv", "sw",
    "ta", "te", "tg", "th", "tk", "tl", "tr", "tt", "uk", "ur", "uz", "vi", "yi", "yo",
    "yue", "zh",
})

MAX_PHRASES = 200
MAX_PHRASE_LENGTH = 200


class RuntimeSettings(BaseModel):
    """Every option the admin panel can change, with its allowed range."""

    model_config = ConfigDict(extra="forbid")

    # Model and decoding
    whisper_model_name: str = Field(min_length=1, max_length=200)
    beam_size: int = Field(default=5, ge=1, le=10)
    temperature_fallback: bool = True

    # Anti-hallucination
    vad_filter: bool = True
    vad_onset: float = Field(default=0.35, ge=0.05, le=0.95)
    vad_offset: float = Field(default=0.20, ge=0.01, le=0.95)
    vad_min_silence_ms: int = Field(default=1000, ge=100, le=10000)
    vad_speech_pad_ms: int = Field(default=400, ge=0, le=2000)
    hallucination_silence_threshold: Optional[float] = Field(default=2.0, ge=0.5, le=30.0)
    low_confidence_avg_logprob: float = Field(default=-1.0, ge=-5.0, le=0.0)
    low_confidence_no_speech_prob: float = Field(default=0.6, ge=0.0, le=1.0)
    low_confidence_compression_ratio: float = Field(default=2.4, ge=1.0, le=10.0)
    hallucination_phrases: list[str] = Field(
        default_factory=lambda: list(DEFAULT_HALLUCINATION_PHRASES)
    )

    # Audio preprocessing
    audio_highpass: bool = True
    audio_loudnorm: bool = True

    # Language and retention
    default_language: Optional[str] = None
    job_retention_hours: int = Field(default=12, ge=1, le=8760)

    @field_validator("hallucination_phrases")
    @classmethod
    def _clean_phrases(cls, phrases: list[str]) -> list[str]:
        cleaned: list[str] = []
        seen: set[str] = set()
        for phrase in phrases:
            phrase = " ".join(phrase.split())
            if not phrase:
                continue
            if len(phrase) > MAX_PHRASE_LENGTH:
                raise ValueError(f"phrases must be at most {MAX_PHRASE_LENGTH} characters")
            if phrase.lower() not in seen:
                seen.add(phrase.lower())
                cleaned.append(phrase)
        if len(cleaned) > MAX_PHRASES:
            raise ValueError(f"at most {MAX_PHRASES} phrases are allowed")
        return cleaned

    @field_validator("default_language")
    @classmethod
    def _check_language(cls, language: Optional[str]) -> Optional[str]:
        if language in (None, ""):
            return None
        if language not in WHISPER_LANGUAGE_CODES:
            raise ValueError("unsupported language code")
        return language

    @model_validator(mode="after")
    def _check_vad_hysteresis(self) -> "RuntimeSettings":
        if self.vad_offset >= self.vad_onset:
            raise ValueError("vad_offset must be lower than vad_onset")
        return self

    def filter_rules(self) -> FilterRules:
        """The hallucination-filter rules these settings describe."""
        return FilterRules(
            avg_logprob=self.low_confidence_avg_logprob,
            no_speech_prob=self.low_confidence_no_speech_prob,
            compression_ratio=self.low_confidence_compression_ratio,
            phrases=tuple(self.hallucination_phrases),
        )


AUTO_DETECT = "auto"


def resolve_language(requested: Optional[str], default_language: Optional[str]) -> Optional[str]:
    """
    The language to transcribe in, or None to auto-detect.

    ``"auto"`` is an explicit request to auto-detect; only a missing value falls
    back to the admin-configured default language.

    Raises:
        ValueError: If the requested language is not supported by Whisper.
    """
    if requested == AUTO_DETECT:
        return None
    if not requested:
        return default_language
    if requested not in WHISPER_LANGUAGE_CODES:
        raise ValueError(f"Unsupported language: {requested}")
    return requested


def allowed_whisper_models(env_model_name: str) -> list[str]:
    """Selectable models: the built-in allowlist plus whatever the env configures."""
    models = list(WHISPER_MODELS)
    if env_model_name and env_model_name not in models:
        models.append(env_model_name)
    return models


def default_runtime_settings(env_model_name: str, env_retention_hours: int) -> RuntimeSettings:
    """Defaults before anything is saved from the panel."""
    return RuntimeSettings(
        whisper_model_name=env_model_name,
        job_retention_hours=env_retention_hours,
    )


def merge_stored(defaults: RuntimeSettings, stored: Optional[dict[str, Any]]) -> RuntimeSettings:
    """
    Overlay saved values on the defaults, tolerating stale or invalid data.

    Unknown keys (from an older or newer version) are ignored, and any field
    that no longer validates falls back to its default instead of breaking
    every transcription.
    """
    if not stored:
        return defaults
    known = {k: v for k, v in stored.items() if k in RuntimeSettings.model_fields}
    candidate = {**defaults.model_dump(), **known}
    try:
        return RuntimeSettings(**candidate)
    except ValidationError as e:
        bad_fields = {err["loc"][0] for err in e.errors() if err.get("loc")}
        logger.error("Ignoring invalid saved runtime settings %s: %s", sorted(bad_fields), e)
        for field in bad_fields:
            candidate[field] = getattr(defaults, field, None)
        try:
            return RuntimeSettings(**candidate)
        except ValidationError:
            logger.error("Saved runtime settings unusable; using defaults")
            return defaults


def diff_settings(old: RuntimeSettings, new: RuntimeSettings) -> list[tuple[str, Any, Any]]:
    """(field, old value, new value) for every field that changed."""
    old_values = old.model_dump()
    new_values = new.model_dump()
    return [
        (field, old_values[field], new_values[field])
        for field in RuntimeSettings.model_fields
        if old_values[field] != new_values[field]
    ]
