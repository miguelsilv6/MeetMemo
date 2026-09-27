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


# --- WhisperModel arguments ------------------------------------------------------

from utils.whisper_options import model_options  # noqa: E402


def test_cpu_model_uses_every_available_cpu_by_default():
    assert model_options("cpu", "int8", 0, available_cpus=10) == {
        "device": "cpu",
        "compute_type": "int8",
        "cpu_threads": 10,
    }


def test_cpu_threads_can_be_pinned():
    assert model_options("cpu", "int8", 6, available_cpus=10)["cpu_threads"] == 6


def test_float16_falls_back_to_int8_on_cpu():
    assert model_options("cpu", "float16", 0, available_cpus=4)["compute_type"] == "int8"


def test_gpu_model_gets_no_cpu_thread_setting():
    assert model_options("cuda:0", "float16", 0, available_cpus=10) == {
        "device": "cuda",
        "compute_type": "float16",
    }
