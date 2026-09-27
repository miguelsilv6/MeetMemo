"""Map settings to faster-whisper ``WhisperModel`` and ``transcribe`` arguments."""
from runtime_settings import RuntimeSettings

from utils.cpu import available_cpu_count, whisper_cpu_threads

# faster-whisper only retries a segment at a higher temperature when a greedy
# (0.0) decode fails the compression_ratio/log_prob gates, so a single 0.0
# leaves those gates with nothing to fall back to.
TEMPERATURE_FALLBACK = (0.0, 0.2, 0.4, 0.6, 0.8, 1.0)

# Whisper's standard decoder quality gates. These decide skipping/retrying
# during decoding; the admin panel's low-confidence thresholds only decide
# which kept segments get flagged for review.
DECODER_GATES = {
    "no_speech_threshold": 0.6,
    "log_prob_threshold": -1.0,
    "compression_ratio_threshold": 2.4,
}


def transcribe_options(runtime: RuntimeSettings) -> dict:
    """
    Keyword arguments for ``WhisperModel.transcribe``.

    VAD keys must match faster_whisper.vad.VadOptions (1.1.0 names the
    thresholds ``onset``/``offset``).
    """
    return {
        "beam_size": runtime.beam_size,
        "best_of": runtime.beam_size,
        "temperature": list(TEMPERATURE_FALLBACK) if runtime.temperature_fallback else 0.0,
        "vad_filter": runtime.vad_filter,
        "vad_parameters": (
            {
                "onset": runtime.vad_onset,
                "offset": runtime.vad_offset,
                "min_silence_duration_ms": runtime.vad_min_silence_ms,
                "speech_pad_ms": runtime.vad_speech_pad_ms,
            }
            if runtime.vad_filter
            else None
        ),
        # hallucination_silence_threshold only works with word timestamps.
        "word_timestamps": runtime.hallucination_silence_threshold is not None,
        "hallucination_silence_threshold": runtime.hallucination_silence_threshold,
        "condition_on_previous_text": False,
        **DECODER_GATES,
    }


def model_options(
    device: str,
    compute_type: str,
    configured_cpu_threads: int = 0,
    available_cpus: int | None = None,
) -> dict:
    """
    Keyword arguments for ``WhisperModel(model_name, **options)``.

    On CPU, faster-whisper defaults to 4 threads whatever the machine has, so
    ``cpu_threads`` is set to every CPU available to the container unless a
    count is configured. float16 is not supported on CPU and falls back to int8.
    """
    base_device = device.split(":")[0]  # "cuda:0" -> "cuda"
    options = {"device": base_device, "compute_type": compute_type}
    if base_device == "cpu":
        if compute_type == "float16":
            options["compute_type"] = "int8"
        available = available_cpus if available_cpus is not None else available_cpu_count()
        options["cpu_threads"] = whisper_cpu_threads(configured_cpu_threads, available)
    return options
