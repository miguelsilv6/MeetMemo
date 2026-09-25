"""Map runtime settings to faster-whisper ``WhisperModel.transcribe`` arguments."""
from runtime_settings import RuntimeSettings

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
