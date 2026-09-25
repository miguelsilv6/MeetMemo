"""Tests for mapping runtime settings to faster-whisper arguments."""
from runtime_settings import RuntimeSettings
from utils.whisper_options import TEMPERATURE_FALLBACK, transcribe_options


def _settings(**overrides) -> RuntimeSettings:
    return RuntimeSettings(whisper_model_name="large-v3", **overrides)


def test_defaults_enable_every_anti_hallucination_measure():
    options = transcribe_options(_settings())
    assert options["beam_size"] == 5 and options["best_of"] == 5
    assert options["temperature"] == list(TEMPERATURE_FALLBACK)
    assert options["vad_filter"] is True
    # VadOptions in faster-whisper 1.1.0 names its thresholds onset/offset.
    assert options["vad_parameters"] == {
        "onset": 0.35,
        "offset": 0.20,
        "min_silence_duration_ms": 1000,
        "speech_pad_ms": 400,
    }
    assert options["word_timestamps"] is True
    assert options["hallucination_silence_threshold"] == 2.0
    assert options["condition_on_previous_text"] is False


def test_disabling_options_maps_to_their_off_values():
    options = transcribe_options(
        _settings(
            temperature_fallback=False,
            vad_filter=False,
            hallucination_silence_threshold=None,
            beam_size=1,
        )
    )
    assert options["temperature"] == 0.0
    assert options["vad_filter"] is False
    assert options["vad_parameters"] is None
    assert options["word_timestamps"] is False
    assert options["hallucination_silence_threshold"] is None
    assert options["beam_size"] == 1
