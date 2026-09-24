"""
Transcription service using faster-whisper.

This service handles Whisper model loading, caching, and transcription processing
with progress tracking. Uses faster-whisper with CTranslate2 for 4x performance
improvement over openai-whisper.
"""
import asyncio
import logging
import threading

from config import Settings
from database import update_error
from faster_whisper import WhisperModel
from repositories.job_repository import JobRepository
from runtime_settings import RuntimeSettings
from utils.hallucination_filter import filter_segments
from utils.whisper_options import transcribe_options

from services.runtime_settings_service import RuntimeSettingsService

logger = logging.getLogger(__name__)

PROGRESS_START = 10
PROGRESS_END = 90
PROGRESS_REPORT_STEP = 5

# One loaded model per process. A service instance is created per request, so
# a per-instance cache would reload the model from disk for every job; keeping
# a single slot also frees the old model when the admin panel switches models
# (two large models side by side can exhaust RAM on a CPU host).
_model_lock = threading.Lock()
_loaded_model: tuple[str, WhisperModel] | None = None  # pylint: disable=invalid-name


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

    def get_model(self, model_name: str) -> WhisperModel:
        """
        Get the process-wide faster-whisper model, loading it if needed.

        Args:
            model_name: Name of the Whisper model (turbo, large-v3, base, small, etc.)

        Returns:
            Loaded WhisperModel instance
        """
        global _loaded_model  # pylint: disable=global-statement
        with _model_lock:
            if _loaded_model is not None and _loaded_model[0] == model_name:
                return _loaded_model[1]

            # Drop the previous model before loading the next one.
            _loaded_model = None
            logger.info("Loading faster-whisper model: %s", model_name)

            compute_type = self.settings.compute_type
            if "cpu" in self.settings.device and compute_type == "float16":
                logger.warning("compute_type 'float16' not supported on CPU. Falling back to 'int8'.")
                compute_type = "int8"

            model = WhisperModel(
                model_name,
                device=self.settings.device.split(':')[0],  # Extract 'cuda' or 'cpu'
                compute_type=compute_type
            )
            _loaded_model = (model_name, model)
            logger.info(
                "faster-whisper model %s loaded successfully on %s with %s precision",
                model_name,
                self.settings.device,
                compute_type
            )
            return model

    def _decode(  # pylint: disable=too-many-arguments,too-many-positional-arguments
        self,
        job_uuid: str,
        file_path: str,
        model_name: str,
        language: str | None,
        options: dict,
        loop: asyncio.AbstractEventLoop,
    ):
        """
        Load the model and fully decode the audio. Runs in a worker thread.

        faster-whisper decodes lazily while its segment generator is consumed,
        so the generator must be drained here too - draining it on the event
        loop would block every other request for the whole transcription.
        """
        model = self.get_model(model_name)
        segments_gen, info = model.transcribe(file_path, language=language, **options)

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
            })
            if duration > 0:
                fraction = min(segment.end / duration, 1.0)
                progress = PROGRESS_START + int((PROGRESS_END - PROGRESS_START) * fraction)
                if progress >= last_reported + PROGRESS_REPORT_STEP:
                    last_reported = progress
                    asyncio.run_coroutine_threadsafe(
                        self.job_repo.update_step_progress(job_uuid, progress), loop
                    )
        return segments, info

    async def transcribe(
        self,
        job_uuid: str,
        file_path: str,
        model_name: str,
        language: str = None,
        runtime: RuntimeSettings | None = None,
    ) -> dict:
        """
        Transcribe audio file with progress tracking using faster-whisper.

        Args:
            job_uuid: Job UUID
            file_path: Path to audio file
            model_name: Whisper model to use
            language: Language code (ISO 639-1) or None for auto-detection
            runtime: Admin-panel settings to apply (loaded if not given)

        Returns:
            Transcription data dict with text, segments, and language

        Raises:
            Exception: If transcription fails
        """
        try:
            await self.job_repo.update_workflow_state(job_uuid, 'transcribing', 0)
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
            raw_segments, info = await loop.run_in_executor(
                None,
                self._decode,
                job_uuid,
                file_path,
                model_name,
                language,
                transcribe_options(runtime),
                loop,
            )

            segments, removed = filter_segments(raw_segments, runtime.filter_rules())
            if removed:
                logger.info(
                    "Removed %d hallucinated/empty segment(s) for job %s",
                    len(removed),
                    job_uuid,
                )

            transcription_data = {
                "text": "".join(s["text"] for s in segments),
                "segments": segments,
                "language": info.language if info.language else (language or "auto"),
                "language_probability": (
                    info.language_probability if info.language else None
                ),
                # Kept for auditability: what was dropped and why, and exactly
                # which model and settings produced this transcript.
                "removed_segments": removed,
                "model_name": model_name,
                "settings": runtime.model_dump(),
            }
            await self.job_repo.save_transcription(job_uuid, transcription_data)

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
