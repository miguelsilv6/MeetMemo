"""
Transcription service using faster-whisper.

This service handles Whisper model loading, caching, and transcription processing
with progress tracking. Uses faster-whisper with CTranslate2 for 4x performance
improvement over openai-whisper.
"""
import asyncio
import logging
import threading
from typing import Callable, Collection

import numpy as np
from config import Settings
from database import update_error
from faster_whisper import WhisperModel
from faster_whisper.audio import decode_audio
from faster_whisper.vad import VadOptions, get_speech_timestamps
from repositories.job_repository import JobRepository
from runtime_settings import RuntimeSettings
from utils.channels import merge_channels
from utils.cpu import available_cpu_count
from utils.hallucination_filter import filter_segments
from utils.language_detection import SAMPLE_RATE, aggregate, speech_windows
from utils.pauses import split_segments_at_pauses
from utils.whisper_options import model_options, transcribe_options

from services.runtime_settings_service import RuntimeSettingsService

logger = logging.getLogger(__name__)

PROGRESS_START = 10
PROGRESS_END = 90
PROGRESS_REPORT_STEP = 5

# The loaded models, per process. A service instance is created per request, so
# a per-instance cache would reload the model from disk for every job. Only the
# models still wanted are kept (one, or two with the Portuguese model on): the
# old one is freed when the admin panel switches models (two large models side
# by side that nobody asks for can exhaust RAM on a CPU host).
_model_lock = threading.Lock()
_loaded_models: dict[str, WhisperModel] = {}


def models_wanted(model_name: str, runtime: RuntimeSettings) -> set[str]:
    """The Whisper models to keep loaded: the general one, and the Portuguese one if enabled."""
    return {model_name, runtime.portuguese_whisper_model} - {None}


def decoding_model(model_name: str, language: str | None, runtime: RuntimeSettings) -> str:
    """
    The model that transcribes ``language``: the Portuguese model for
    Portuguese (when the admin enabled it), the general model otherwise.
    """
    if language == "pt" and runtime.portuguese_whisper_model:
        return runtime.portuguese_whisper_model
    return model_name


class TranscriptionService:
    """Service for audio transcription using faster-whisper."""

    def __init__(self, settings: Settings, job_repo: JobRepository):
        """
        Initialize TranscriptionService.

        Args:
            settings: Application settings
            job_repo: Job repository for database operations
        """
        self.settings = settings
        self.job_repo = job_repo

    def get_model(self, model_name: str, keep: Collection[str] = ()) -> WhisperModel:
        """
        Get a process-wide faster-whisper model, loading it if needed.

        Normally one model is kept in memory. With the Portuguese model
        enabled in the admin panel two are (the general one detects the
        language and transcribes the other languages), so the caller says in
        ``keep`` which others are still wanted: every other loaded model is
        dropped, before the next one is loaded.

        Args:
            model_name: Name of the Whisper model (turbo, large-v3, base, small, etc.)
            keep: Other models to keep loaded

        Returns:
            Loaded WhisperModel instance
        """
        with _model_lock:
            wanted = {model_name, *keep}
            for name in [name for name in _loaded_models if name not in wanted]:
                logger.info("Releasing faster-whisper model: %s", name)
                del _loaded_models[name]
            if model_name in _loaded_models:
                return _loaded_models[model_name]

            logger.info("Loading faster-whisper model: %s", model_name)

            available = available_cpu_count()
            options = model_options(
                self.settings.device,
                self.settings.compute_type,
                self.settings.whisper_cpu_threads,
                available,
            )
            if options["compute_type"] != self.settings.compute_type:
                logger.warning(
                    "compute_type '%s' not supported on CPU. Falling back to '%s'.",
                    self.settings.compute_type,
                    options["compute_type"],
                )

            model = WhisperModel(model_name, **options)
            _loaded_models[model_name] = model
            logger.info(
                "faster-whisper model %s loaded successfully on %s with %s precision%s",
                model_name,
                self.settings.device,
                options["compute_type"],
                (
                    f", {options['cpu_threads']} CPU threads ({available} CPUs available)"
                    if "cpu_threads" in options
                    else ""
                ),
            )
            return model

    def _decode(
        self,
        audio,
        model_name: str,
        language: str | None,
        options: dict,
        on_progress: Callable[[int], None] | None = None,
        keep: Collection[str] = (),
    ):
        """
        Load the model and fully decode the audio. Runs in a worker thread.

        faster-whisper decodes lazily while its segment generator is consumed,
        so the generator must be drained here too - draining it on the event
        loop would block every other request for the whole transcription.
        """
        model = self.get_model(model_name, keep)
        segments_gen, info = model.transcribe(audio, language=language, **options)

        segments = []
        duration = info.duration or 0
        last_reported = PROGRESS_START
        for segment in segments_gen:
            segments.append({
                "id": segment.id,
                "start": segment.start,
                "end": segment.end,
                "text": segment.text,
                "avg_logprob": segment.avg_logprob,
                "no_speech_prob": segment.no_speech_prob,
                "compression_ratio": segment.compression_ratio,
                "words": [
                    {
                        "start": round(word.start, 2),
                        "end": round(word.end, 2),
                        "word": word.word,
                        "probability": round(word.probability, 3),
                    }
                    for word in (segment.words or [])
                ],
            })
            if duration > 0:
                fraction = min(segment.end / duration, 1.0)
                progress = PROGRESS_START + int((PROGRESS_END - PROGRESS_START) * fraction)
                if on_progress and progress >= last_reported + PROGRESS_REPORT_STEP:
                    last_reported = progress
                    on_progress(progress)
        return segments, info

    def detect_language(
        self, audio: np.ndarray, model_name: str, runtime: RuntimeSettings
    ) -> dict | None:
        """
        Detect the language from windows of speech spread over the recording.

        Returns None when no speech is found (the transcription then falls
        back to faster-whisper's own detection).
        """
        model = self.get_model(model_name, models_wanted(model_name, runtime))
        if runtime.vad_filter:
            speech = get_speech_timestamps(audio, VadOptions(
                onset=runtime.vad_onset,
                offset=runtime.vad_offset,
                min_silence_duration_ms=runtime.vad_min_silence_ms,
                speech_pad_ms=runtime.vad_speech_pad_ms,
            ))
        else:
            speech = [{"start": 0, "end": len(audio)}]

        windows = []
        for spans in speech_windows(speech, runtime.language_detection_windows):
            chunk = np.concatenate([audio[start:end] for start, end in spans])
            _, _, probabilities = model.detect_language(audio=chunk)
            windows.append({
                "start": spans[0][0] / SAMPLE_RATE,
                "end": spans[-1][1] / SAMPLE_RATE,
                "speech": len(chunk) / SAMPLE_RATE,
                "probs": probabilities,
            })
        detection = aggregate(windows)
        if detection:
            logger.info(
                "Detected language %s (%.2f) from %d window(s); flags: %s",
                detection["language"],
                detection["probability"],
                len(windows),
                ", ".join(detection["flags"]) or "none",
            )
        return detection

    def transcribe_file(
        self,
        file_path: str,
        model_name: str,
        language: str | None,
        runtime: RuntimeSettings,
        on_progress: Callable[[int], None] | None = None,
    ) -> dict:
        """
        Transcribe an audio file and filter the result, without touching the
        database (the pipeline saves it; the evaluation script compares it).
        Runs in a worker thread.

        Without a ``language``, it is detected over the whole recording (see
        ``utils.language_detection``) and the transcription uses that choice.
        A given ``language`` (picked by the user or the admin's default) has no
        detection probability: it was not detected.
        """
        audio = decode_audio(file_path, sampling_rate=SAMPLE_RATE)
        detection = None
        if language is None:
            detection = self.detect_language(audio, model_name, runtime)
        chosen = language or (detection["language"] if detection else None)
        # The general model detects the language (and transcribes every
        # language but Portuguese); the Portuguese model, if enabled, only
        # transcribes Portuguese.
        decoder = decoding_model(model_name, chosen, runtime)

        raw_segments, info = self._decode(
            audio, decoder, chosen, transcribe_options(runtime), on_progress,
            models_wanted(model_name, runtime),
        )
        segments, removed = filter_segments(
            split_segments_at_pauses(raw_segments), runtime.filter_rules()
        )
        if language:
            detected, probability, detection = language, None, {"forced": True}
        elif detection:
            detected, probability = detection["language"], detection["probability"]
        else:  # no speech found: what faster-whisper made of it, if anything
            detected = info.language or "auto"
            probability = info.language_probability if info.language else None
        return {
            "text": "".join(s["text"] for s in segments),
            "segments": segments,
            "language": detected,
            "language_probability": probability,
            "language_detection": detection,
            "duration": info.duration,
            # Kept for auditability: what was dropped and why, and exactly
            # which model and settings produced this transcript.
            "removed_segments": removed,
            "model_name": decoder,
            # The model that detected the language, when another one did
            # (None: the language was given, or the same model did both).
            "detection_model": (
                model_name if detection and not language and decoder != model_name else None
            ),
            "settings": runtime.model_dump(),
        }

    def transcribe_channels(
        self,
        paths: list[str],
        model_name: str,
        language: str | None,
        runtime: RuntimeSettings,
        on_progress: Callable[[int], None] | None = None,
    ) -> dict:
        """
        Transcribe each channel of a recording on its own (one speaker per
        channel) and merge them: every channel gets its own language detection
        and its speaker. Runs in a worker thread.
        """
        span = (PROGRESS_END - PROGRESS_START) / len(paths)
        parts = []
        for n, path in enumerate(paths):

            def channel_progress(progress: int, n: int = n) -> None:
                if on_progress:
                    done = (progress - PROGRESS_START) / (PROGRESS_END - PROGRESS_START)
                    on_progress(int(PROGRESS_START + span * (n + done)))

            parts.append(
                self.transcribe_file(path, model_name, language, runtime, channel_progress)
            )
        return merge_channels(parts)

    async def transcribe(  # pylint: disable=too-many-arguments,too-many-positional-arguments
        self,
        job_uuid: str,
        file_path: str,
        model_name: str,
        language: str = None,
        runtime: RuntimeSettings | None = None,
        channels: dict | None = None,
    ) -> dict:
        """
        Transcribe audio file with progress tracking using faster-whisper.

        Args:
            job_uuid: Job UUID
            file_path: Path to audio file
            model_name: Whisper model to use
            language: Language code (ISO 639-1) or None for auto-detection
            runtime: Admin-panel settings to apply (loaded if not given)
            channels: How the recording's channels are to be transcribed
                (``AudioService.ensure_channel_audio``); "split" transcribes
                each channel's derivative on its own

        Returns:
            Transcription data dict with text, segments, and language

        Raises:
            Exception: If transcription fails
        """
        try:
            await self.job_repo.update_workflow_state(job_uuid, 'transcribing', 0, model_name)
            if runtime is None:
                runtime = await RuntimeSettingsService(self.settings).get()
            logger.info(
                "Starting transcription for job %s with model %s, language: %s",
                job_uuid,
                model_name,
                language or "auto",
            )

            await self.job_repo.update_step_progress(job_uuid, PROGRESS_START)
            loop = asyncio.get_running_loop()

            def on_progress(progress: int) -> None:
                asyncio.run_coroutine_threadsafe(
                    self.job_repo.update_step_progress(job_uuid, progress), loop
                )

            split = bool(channels and channels.get("mode") == "split" and channels.get("paths"))
            transcription_data = await loop.run_in_executor(
                None,
                self.transcribe_channels if split else self.transcribe_file,
                channels["paths"] if split else file_path,
                model_name,
                language,
                runtime,
                on_progress,
            )
            transcription_data["channel_mode"] = "split" if split else "mono"
            if channels:
                # The decision and its numbers, for review (not the server paths).
                transcription_data["channel_analysis"] = {
                    k: v for k, v in channels.items() if k != "paths"
                }
            if transcription_data["removed_segments"]:
                logger.info(
                    "Removed %d hallucinated/empty segment(s) for job %s",
                    len(transcription_data["removed_segments"]),
                    job_uuid,
                )
            await self.job_repo.save_transcription(job_uuid, transcription_data)
            # The decoder's own measure of the audio's length, which the timing
            # of this step and the estimates of the next ones are based on.
            await self.job_repo.set_audio_seconds(job_uuid, transcription_data.get("duration"))
            used = transcription_data.get("model_name")
            if used and used != model_name:
                # The Portuguese model did the work: its time is not the general
                # model's, so the timing is kept under its name.
                await self.job_repo.set_step_model(job_uuid, used)

            # Update state to transcribed
            await self.job_repo.update_step_progress(job_uuid, 100)
            await self.job_repo.update_workflow_state(job_uuid, 'transcribed', 100)
            logger.info("Transcription step completed for job %s", job_uuid)

            return transcription_data

        except Exception as e:
            error_msg = str(e)
            logger.error(
                "Transcription failed for job %s: %s",
                job_uuid,
                error_msg,
                exc_info=True
            )
            await update_error(job_uuid, f"Transcription failed: {error_msg}")
            await self.job_repo.update_workflow_state(job_uuid, 'error', 0)
            raise
