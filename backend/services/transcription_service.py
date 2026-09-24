"""
Transcription service using faster-whisper.

This service handles Whisper model loading, caching, and transcription processing
with progress tracking. Uses faster-whisper with CTranslate2 for 4x performance
improvement over openai-whisper.
"""
import asyncio
import logging

from config import Settings
from database import update_error
from faster_whisper import WhisperModel
from repositories.job_repository import JobRepository
from utils.hallucination_filter import filter_segments

logger = logging.getLogger(__name__)

# Silero VAD tuned for phone calls: a lower speech onset than the default
# (0.5) keeps quiet, narrowband speech that would otherwise be cut, and a
# shorter minimum silence splits on turn-taking pauses. Keys must match
# faster_whisper.vad.VadOptions (1.1.0 names them onset/offset); offset's
# default does not follow a custom onset, so the usual 0.15 gap is set here.
VAD_PARAMETERS = {
    "onset": 0.35,
    "offset": 0.20,
    "min_silence_duration_ms": 1000,
    "speech_pad_ms": 400,
}

# Skip silent stretches longer than this (seconds) when the decoder shows signs
# of hallucinating over them. Requires word-level timestamps.
HALLUCINATION_SILENCE_THRESHOLD_S = 2.0

# faster-whisper only retries a segment at a higher temperature when a greedy
# (0.0) decode fails the compression_ratio/log_prob gates, so a single 0.0
# would leave those gates with nothing to fall back to.
TEMPERATURE_FALLBACK = [0.0, 0.2, 0.4, 0.6, 0.8, 1.0]

PROGRESS_START = 10
PROGRESS_END = 90
PROGRESS_REPORT_STEP = 5


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
        self._model_cache = {}

    def get_model(self, model_name: str = "turbo"):
        """
        Get cached faster-whisper model.

        Args:
            model_name: Name of the Whisper model (turbo, large-v3, base, small, etc.)

        Returns:
            Loaded WhisperModel instance
        """
        if model_name not in self._model_cache:
            logger.info("Loading faster-whisper model: %s", model_name)

            # Determine compute type based on device
            compute_type = self.settings.compute_type
            if "cpu" in self.settings.device and compute_type == "float16":
                logger.warning("compute_type 'float16' not supported on CPU. Falling back to 'int8'.")
                compute_type = "int8"

            # Load model with faster-whisper
            model = WhisperModel(
                model_name,
                device=self.settings.device.split(':')[0],  # Extract 'cuda' or 'cpu'
                compute_type=compute_type
            )
            self._model_cache[model_name] = model
            logger.info(
                "faster-whisper model %s loaded successfully on %s with %s precision",
                model_name,
                self.settings.device,
                compute_type
            )
        return self._model_cache[model_name]

    def _decode(  # pylint: disable=too-many-arguments,too-many-positional-arguments
        self,
        job_uuid: str,
        file_path: str,
        model_name: str,
        language: str | None,
        loop: asyncio.AbstractEventLoop,
    ):
        """
        Load the model and fully decode the audio. Runs in a worker thread.

        faster-whisper decodes lazily while its segment generator is consumed,
        so the generator must be drained here too - draining it on the event
        loop would block every other request for the whole transcription.
        """
        model = self.get_model(model_name)
        segments_gen, info = model.transcribe(
            file_path,
            language=language,
            beam_size=5,
            best_of=5,
            temperature=TEMPERATURE_FALLBACK,
            vad_filter=True,
            vad_parameters=VAD_PARAMETERS,
            word_timestamps=True,
            hallucination_silence_threshold=HALLUCINATION_SILENCE_THRESHOLD_S,
            condition_on_previous_text=False,
            no_speech_threshold=0.6,
            log_prob_threshold=-1.0,
            compression_ratio_threshold=2.4,
        )

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
        model_name: str = "turbo",
        language: str = None
    ) -> dict:
        """
        Transcribe audio file with progress tracking using faster-whisper.

        Args:
            job_uuid: Job UUID
            file_path: Path to audio file
            model_name: Whisper model to use
            language: Language code (ISO 639-1) or None for auto-detection

        Returns:
            Transcription data dict with text, segments, and language

        Raises:
            Exception: If transcription fails
        """
        try:
            await self.job_repo.update_workflow_state(job_uuid, 'transcribing', 0)
            logger.info(
                "Starting transcription for job %s with model %s, language: %s",
                job_uuid,
                model_name,
                language or "auto",
            )

            await self.job_repo.update_step_progress(job_uuid, PROGRESS_START)
            loop = asyncio.get_running_loop()
            raw_segments, info = await loop.run_in_executor(
                None, self._decode, job_uuid, file_path, model_name, language, loop
            )

            segments, removed = filter_segments(raw_segments)
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
                # Kept for auditability: what was dropped, and why.
                "removed_segments": removed,
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
