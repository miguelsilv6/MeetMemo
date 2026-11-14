"""
How an audio was processed, for the administrator: the Whisper model, the
diarization model that really made its speakers, the language, and the
settings the transcription ran with.

Everything comes from what processing already stores with the audio (the
transcription keeps its model and a copy of the settings, the diarization the
model that made it), so it stays true after the admin panel's settings change.
An audio processed before the settings were kept has no copy: those fields
are None.
"""
from typing import Optional

# The settings of the transcription step shown (the rest of the copy is the
# prompts, retention, quotas and so on, which did not shape this audio).
TRANSCRIPTION_SETTINGS = (
    "portuguese_whisper_model",
    "beam_size",
    "temperature_fallback",
    "vad_filter",
    "vad_onset",
    "vad_offset",
    "vad_min_silence_ms",
    "vad_speech_pad_ms",
    "hallucination_silence_threshold",
    "low_confidence_avg_logprob",
    "low_confidence_no_speech_prob",
    "low_confidence_compression_ratio",
    "audio_highpass",
    "audio_loudnorm",
    "stereo_mode",
    "default_language",
    "language_detection_windows",
)


def _settings(transcription: dict) -> Optional[dict]:
    """The transcription's settings (None when the audio has no copy of them)."""
    stored = transcription.get("settings")
    if not isinstance(stored, dict):
        return None
    shown = {key: stored.get(key) for key in TRANSCRIPTION_SETTINGS if key in stored}
    phrases = stored.get("hallucination_phrases")
    if isinstance(phrases, list):
        shown["hallucination_phrases_count"] = len(phrases)
    return shown


def _whisper_models(transcription: dict, job: dict) -> list[str]:
    """Every Whisper model that transcribed the audio (a call split by channel may use two)."""
    main = transcription.get("model_name") or job.get("model_name")
    channels = (transcription.get("language_detection") or {}).get("channels") or []
    models = [main, *(channel.get("model_name") for channel in channels)]
    return list(dict.fromkeys(model for model in models if model))


def processing_info(
    job: dict, transcription: Optional[dict], diarization: Optional[dict]
) -> dict:
    """What was used to process ``job``: its stored transcription and diarization."""
    transcription = transcription or {}
    detection = transcription.get("language_detection") or {}
    language = transcription.get("language")
    diarization_model = (diarization or {}).get("model")
    return {
        "file_name": job["file_name"],
        "duration_seconds": transcription.get("duration") or job.get("audio_seconds"),
        "whisper_model": transcription.get("model_name") or job.get("model_name"),
        "whisper_models": _whisper_models(transcription, job),
        # The general model that detected the language, when the Portuguese one transcribed.
        "detection_model": transcription.get("detection_model"),
        "language": None if language is None else {
            "code": language,
            "probability": transcription.get("language_probability"),
            "forced": bool(detection.get("forced")),
        },
        "channel_mode": transcription.get("channel_mode"),
        "num_speakers": job.get("num_speakers"),
        "diarization_model": diarization_model,
        # One speaker per channel: no diarization model took part.
        "diarization_by_channels": diarization_model == "channels",
        "settings": _settings(transcription),
    }
