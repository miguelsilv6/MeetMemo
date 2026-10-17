"""
Alignment service for combining transcription and diarization.

This service aligns Whisper transcription segments with PyAnnote speaker labels
to create the final speaker-attributed transcript.
"""
import json
import logging
import os

import aiofiles
from config import Settings
from database import update_error, update_status
from repositories.job_repository import JobRepository
from utils.word_alignment import split_by_speaker

logger = logging.getLogger(__name__)


class AlignmentService:
    """Service for aligning transcription with speaker diarization."""

    def __init__(self, settings: Settings, job_repo: JobRepository):
        """
        Initialize AlignmentService.

        Args:
            settings: Application settings
            job_repo: Job repository for database operations
        """
        self.settings = settings
        self.job_repo = job_repo

    async def align(  # pylint: disable=too-many-locals
        self, job_uuid: str, file_name: str
    ) -> list[dict]:
        """
        Align transcription segments with speaker labels.

        Args:
            job_uuid: Job UUID
            file_name: File name for saving transcript

        Returns:
            List of aligned transcript segments

        Raises:
            Exception: If alignment fails
        """
        try:
            await self.job_repo.update_workflow_state(job_uuid, 'aligning', 0)
            logger.info("Starting alignment for job %s", job_uuid)

            # Get transcription and diarization data
            await self.job_repo.update_step_progress(job_uuid, 10)
            transcription_data = await self.job_repo.get_transcription(job_uuid)
            diarization_data = await self.job_repo.get_diarization(job_uuid)

            if not transcription_data:
                raise ValueError("Transcription data not found")
            if not diarization_data:
                raise ValueError("Diarization data not found")

            await self.job_repo.update_step_progress(job_uuid, 30)

            # Align speakers with text segments
            await self.job_repo.update_step_progress(job_uuid, 50)

            # Create aligned transcript
            aligned_transcript = []
            text_segments = transcription_data.get("segments", [])
            speaker_segments = diarization_data.get("segments", [])

            for text_seg in text_segments:
                if text_seg.get("speaker"):
                    # Transcribed from one channel: its speaker is known.
                    parts = [{
                        "speaker": text_seg["speaker"],
                        "start": text_seg.get("start", 0),
                        "end": text_seg.get("end", 0),
                        "text": (text_seg.get("text") or "").strip(),
                        "words": text_seg.get("words") or [],
                        **({"low_confidence": True} if text_seg.get("low_confidence") else {}),
                    }]
                else:
                    # Word by word, split where the speaker changes.
                    parts = split_by_speaker(text_seg, speaker_segments)

                for part in parts:
                    aligned_segment = {
                        "speaker": part["speaker"],
                        "text": part["text"],
                        "start": f"{part['start']:.2f}",
                        "end": f"{part['end']:.2f}",
                    }
                    if part.get("low_confidence"):
                        aligned_segment["low_confidence"] = True
                    if part["words"]:
                        aligned_segment["words"] = part["words"]
                    aligned_transcript.append(aligned_segment)

            await self.job_repo.update_step_progress(job_uuid, 80)

            # Save aligned transcript to file
            os.makedirs(self.settings.transcript_dir, exist_ok=True)
            json_path = os.path.join(self.settings.transcript_dir, f"{file_name}.json")
            json_str = json.dumps(aligned_transcript, indent=4)
            async with aiofiles.open(json_path, "w", encoding="utf-8") as f:
                await f.write(json_str)

            # Update state to completed
            await self.job_repo.update_step_progress(job_uuid, 100)
            await self.job_repo.update_workflow_state(job_uuid, 'completed', 100)
            await update_status(job_uuid, 200)
            logger.info("Alignment step completed for job %s", job_uuid)

            return aligned_transcript

        except Exception as e:
            error_msg = str(e)
            logger.error(
                "Alignment failed for job %s: %s",
                job_uuid,
                error_msg,
                exc_info=True
            )
            await update_error(job_uuid, f"Alignment failed: {error_msg}")
            await self.job_repo.update_workflow_state(job_uuid, 'error', 0)
            raise
