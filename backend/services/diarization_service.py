"""
Diarization service using PyAnnote.

This service handles PyAnnote pipeline loading, caching, and speaker diarization
processing with progress tracking. The pipeline is the one the admin panel
selects (runtime setting diarization_model), loaded on first use.
"""
import asyncio
import gc
import logging
import threading
from typing import Optional

import torch
import torchaudio
from config import Settings
from database import update_error
from pyannote.audio import Pipeline
from repositories.job_repository import JobRepository

logger = logging.getLogger(__name__)

# One loaded pipeline per process. A service instance is created per request,
# so a per-instance cache would reload the pipeline from disk for every audio.
# Switching models (admin panel) loads the new one first and only then frees
# the old one, so a model that cannot be loaded leaves the current one in place.
_pipeline_lock = threading.Lock()
_loaded_pipeline: tuple[str, Pipeline] | None = None  # pylint: disable=invalid-name


class DiarizationModelError(Exception):
    """The diarization pipeline could not be loaded."""


class DiarizationService:
    """Service for speaker diarization using PyAnnote."""

    def __init__(self, settings: Settings, job_repo: JobRepository):
        """
        Initialize DiarizationService.

        Args:
            settings: Application settings
            job_repo: Job repository for database operations
        """
        self.settings = settings
        self.job_repo = job_repo

    def get_pipeline(self, model_name: Optional[str] = None) -> Pipeline:
        """
        Get the process-wide PyAnnote pipeline for ``model_name`` (the env's
        PYANNOTE_MODEL_NAME when None), loading it if needed. Blocking.

        Raises:
            DiarizationModelError: The pipeline could not be loaded (e.g. the
                gated model's conditions were not accepted on Hugging Face).
        """
        global _loaded_pipeline  # pylint: disable=global-statement
        model_name = model_name or self.settings.pyannote_model_name
        with _pipeline_lock:
            if _loaded_pipeline is not None and _loaded_pipeline[0] == model_name:
                return _loaded_pipeline[1]

            logger.info("Loading PyAnnote speaker diarization pipeline %s", model_name)
            try:
                pipeline = Pipeline.from_pretrained(model_name, token=self.settings.hf_token)
                if pipeline is None:
                    raise RuntimeError("no access to the model")
                pipeline = pipeline.to(torch.device(self.settings.device))
            except Exception as e:  # pylint: disable=broad-exception-caught
                raise DiarizationModelError(
                    f"Could not load the diarization model {model_name}: {e}. "
                    "Accept its conditions on Hugging Face "
                    f"(https://huggingface.co/{model_name}) with the account of HF_TOKEN, "
                    "or choose another diarization model in the admin panel."
                ) from e

            previous, _loaded_pipeline = _loaded_pipeline, (model_name, pipeline)
            if previous is not None:
                logger.info("Releasing diarization pipeline %s", previous[0])
                del previous
                gc.collect()
                if torch.cuda.is_available():
                    torch.cuda.empty_cache()
            logger.info(
                "PyAnnote pipeline %s loaded successfully on %s (%d torch CPU threads)",
                model_name,
                self.settings.device,
                torch.get_num_threads(),
            )
            return pipeline

    async def diarize(
        self, job_uuid: str, file_path: str, model_name: Optional[str] = None
    ) -> dict:
        """
        Perform speaker diarization with progress tracking.

        Args:
            job_uuid: Job UUID
            file_path: Path to audio file
            model_name: The pyannote pipeline (the admin panel's choice);
                None for the env's PYANNOTE_MODEL_NAME

        Returns:
            Diarization data dict with speaker segments

        Raises:
            Exception: If diarization fails
        """
        try:
            await self.job_repo.update_workflow_state(job_uuid, 'diarizing', 0)
            logger.info("Starting diarization for job %s", job_uuid)

            model_name = model_name or self.settings.pyannote_model_name

            # Diarize audio - run in executor to avoid blocking event loop.
            # Loading the pipeline (a download the first time), torchaudio.load
            # and the pipeline are all blocking; bundle them together so none
            # runs on the event loop thread. Passing the waveform dict
            # bypasses torchcodec, which fails on CUDA 12.8.
            await self.job_repo.update_step_progress(job_uuid, 10)
            loop = asyncio.get_event_loop()
            def _load_and_diarize():
                pipeline = self.get_pipeline(model_name)
                waveform, sample_rate = torchaudio.load(file_path)
                return pipeline({"waveform": waveform, "sample_rate": sample_rate})
            diarization = await loop.run_in_executor(None, _load_and_diarize)

            await self.job_repo.update_step_progress(job_uuid, 90)
            logger.info("Diarization complete for job %s", job_uuid)

            # Convert diarization to serializable format
            # pyannote 4.x returns a DiarizeOutput; itertracks is on the inner Annotation
            # The model is kept with the result, so it is known which
            # pipeline made each diarization.
            diarization_data = {
                "model": model_name,
                "segments": [],
            }

            for turn, _, speaker in diarization.speaker_diarization.itertracks(yield_label=True):
                diarization_data["segments"].append({
                    "start": turn.start,
                    "end": turn.end,
                    "speaker": speaker
                })

            # Save diarization data to database
            await self.job_repo.save_diarization(job_uuid, diarization_data)

            # Update state to diarized
            await self.job_repo.update_step_progress(job_uuid, 100)
            await self.job_repo.update_workflow_state(job_uuid, 'diarized', 100)
            logger.info("Diarization step completed for job %s", job_uuid)

            return diarization_data

        except Exception as e:
            error_msg = str(e)
            logger.error(
                "Diarization failed for job %s: %s",
                job_uuid,
                error_msg,
                exc_info=True
            )
            await update_error(job_uuid, f"Diarization failed: {error_msg}")
            await self.job_repo.update_workflow_state(job_uuid, 'error', 0)
            raise
