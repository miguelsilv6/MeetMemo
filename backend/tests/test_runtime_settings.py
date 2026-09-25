"""Tests for the admin-tunable runtime settings model."""
import pytest
from pydantic import ValidationError
from runtime_settings import (
    RuntimeSettings,
    allowed_whisper_models,
    default_runtime_settings,
    diff_settings,
    merge_stored,
    resolve_language,
)
from utils.hallucination_filter import DEFAULT_HALLUCINATION_PHRASES


def _defaults() -> RuntimeSettings:
    return default_runtime_settings("large-v3", 12)


def test_defaults_come_from_the_environment_and_tuned_constants():
    s = _defaults()
    assert s.whisper_model_name == "large-v3"
    assert s.job_retention_hours == 12
    assert s.vad_onset == 0.35 and s.vad_offset == 0.20
    assert s.hallucination_phrases == list(DEFAULT_HALLUCINATION_PHRASES)
    assert s.default_language is None


def test_rejects_unknown_fields_and_out_of_range_values():
    with pytest.raises(ValidationError):
        RuntimeSettings(whisper_model_name="large-v3", surprise=True)
    with pytest.raises(ValidationError):
        RuntimeSettings(whisper_model_name="large-v3", beam_size=0)
    with pytest.raises(ValidationError):
        RuntimeSettings(whisper_model_name="large-v3", job_retention_hours=0)


def test_vad_offset_must_stay_below_onset():
    with pytest.raises(ValidationError, match="vad_offset"):
        RuntimeSettings(whisper_model_name="large-v3", vad_onset=0.3, vad_offset=0.3)


def test_default_language_must_be_a_whisper_code():
    assert RuntimeSettings(whisper_model_name="x", default_language="pt").default_language == "pt"
    assert RuntimeSettings(whisper_model_name="x", default_language="").default_language is None
    with pytest.raises(ValidationError):
        RuntimeSettings(whisper_model_name="x", default_language="pt-PT")


def test_phrases_are_trimmed_deduplicated_and_blank_ones_dropped():
    s = RuntimeSettings(
        whisper_model_name="x",
        hallucination_phrases=["  Obrigado   por assistir ", "obrigado por assistir", "", "Outra"],
    )
    assert s.hallucination_phrases == ["Obrigado por assistir", "Outra"]


def test_phrase_length_is_limited():
    with pytest.raises(ValidationError):
        RuntimeSettings(whisper_model_name="x", hallucination_phrases=["a" * 201])


def test_filter_rules_mirror_the_settings():
    rules = RuntimeSettings(
        whisper_model_name="x",
        low_confidence_avg_logprob=-0.5,
        hallucination_phrases=["Frase"],
    ).filter_rules()
    assert rules.avg_logprob == -0.5
    assert rules.phrases == ("Frase",)


def test_merge_overlays_saved_values_on_defaults():
    merged = merge_stored(_defaults(), {"beam_size": 3, "default_language": "pt"})
    assert merged.beam_size == 3
    assert merged.default_language == "pt"
    assert merged.whisper_model_name == "large-v3"


def test_merge_ignores_unknown_keys_and_falls_back_on_invalid_ones():
    merged = merge_stored(_defaults(), {"removed_option": 1, "beam_size": 99, "vad_filter": False})
    assert merged.beam_size == 5
    assert merged.vad_filter is False


def test_merge_with_nothing_saved_returns_defaults():
    assert merge_stored(_defaults(), None) == _defaults()


def test_diff_lists_only_changed_fields():
    old = _defaults()
    new = old.model_copy(update={"beam_size": 2, "audio_loudnorm": False})
    assert diff_settings(old, new) == [("beam_size", 5, 2), ("audio_loudnorm", True, False)]
    assert diff_settings(old, old) == []


def test_allowed_models_include_a_custom_env_model():
    assert "large-v3" in allowed_whisper_models("large-v3")
    assert allowed_whisper_models("/models/custom")[-1] == "/models/custom"
    assert "org/some-repo" not in allowed_whisper_models("large-v3")


def test_resolve_language():
    assert resolve_language("auto", "pt") is None
    assert resolve_language(None, "pt") == "pt"
    assert resolve_language("", None) is None
    assert resolve_language("en", "pt") == "en"
    with pytest.raises(ValueError):
        resolve_language("klingon", "pt")
