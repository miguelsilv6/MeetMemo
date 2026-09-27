"""
The processing steps of one audio (transcription, diarization, alignment),
shared by the step endpoints the browser drives and the server-side project
queue.

The step services are passed in rather than imported here, so this module
does not load the ML libraries they depend on.
"""
import logging
import os
from typing import Any, Optional

from config import Settings
from runtime_settings import RuntimeSettings, resolve_language

from services.runtime_settings_service import RuntimeSettingsService

logger = logging.getLogger(__name__)


def resolve_transcription_options(
    job: dict,
    runtime: RuntimeSettings,
    allowed_models: list[str],
    requested_model: Optional[str] = None,
    requested_language: Optional[str] = None,
) -> tuple[str, Optional[str]]:
    """
    The Whisper model and language to transcribe a job with.

    Per-job choices come first, then the request, then the admin-panel
    settings.

    Raises:
        ValueError: If the model is not allowed or the language unsupported.
    """
    model = job.get("model_name") or requested_model or runtime.whisper_model_name
    # Anything outside the allowlist would be fetched from Hugging Face as a
    # repo id by faster-whisper.
    if model not in allowed_models:
        raise ValueError(f"Unsupported model: {model}")
    language = resolve_language(
        job.get("language") or requested_language, runtime.default_language
    )
    return model, language


class JobPipeline:
    """Runs the processing steps of an audio with the admin-panel settings."""

    def __init__(  # pylint: disable=too-many-arguments,too-many-positional-arguments
        self,
        settings: Settings,
        audio_service: Any,
        transcription_service: Any,
        diarization_service: Any,
        alignment_service: Any,
        runtime_settings: Optional[RuntimeSettingsService] = None,
    ):
        self.settings = settings
        self.audio_service = audio_service
        self.transcription_service = transcription_service
        self.diarization_service = diarization_service
        self.alignment_service = alignment_service
        self.runtime_settings = runtime_settings or RuntimeSettingsService(settings)

    def _audio_path(self, job: dict) -> str:
        return os.path.join(self.settings.upload_dir, job["file_name"])

    async def transcribe(self, job: dict) -> None:
        """Transcription step (the step records its own failure on the job)."""
        runtime = await self.runtime_settings.get()
        model, language = resolve_transcription_options(
            job, runtime, self.runtime_settings.allowed_models()
        )
        audio_path = await self.audio_service.ensure_asr_audio(
            str(job["uuid"]), self._audio_path(job), runtime.audio_highpass, runtime.audio_loudnorm
        )
        await self.transcription_service.transcribe(
            str(job["uuid"]), audio_path, model, language, runtime
        )

    async def diarize(self, job: dict) -> None:
        """Speaker diarization step."""
        runtime = await self.runtime_settings.get()
        audio_path = await self.audio_service.ensure_asr_audio(
            str(job["uuid"]), self._audio_path(job), runtime.audio_highpass, runtime.audio_loudnorm
        )
        await self.diarization_service.diarize(str(job["uuid"]), audio_path)

    async def align(self, job: dict) -> None:
        """Alignment step: speakers onto the transcript, saved as the transcript file."""
        base_name = os.path.splitext(job["file_name"])[0]
        await self.alignment_service.align(str(job["uuid"]), base_name)

    async def run_remaining(self, job: dict) -> None:
        """Run every step the audio still needs, from its current state."""
        state = job.get("workflow_state", "uploaded")
        steps = {
            "uploaded": (self.transcribe, self.diarize, self.align),
            "transcribed": (self.diarize, self.align),
            "diarized": (self.align,),
        }.get(state, ())
        for step in steps:
            await step(job)
