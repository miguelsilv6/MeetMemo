"""
Speakers router for speaker management operations.

This router handles speaker name updates. Speakers are only ever renamed by
the user; nothing assigns names automatically.
"""
import logging
import os

from config import Settings, get_settings
from dependencies import get_job_repository, get_speaker_service, get_summary_service
from fastapi import APIRouter, Depends, HTTPException
from models import SpeakerNameMapping, SpeakerUpdateResponse
from repositories.job_repository import JobRepository
from services.speaker_service import SpeakerService
from services.summary_service import SummaryService

logger = logging.getLogger(__name__)

router = APIRouter()


@router.patch("/jobs/{uuid}/speakers", response_model=SpeakerUpdateResponse)
async def update_speakers(  # pylint: disable=too-many-arguments,too-many-positional-arguments
    uuid: str,
    speaker_map: SpeakerNameMapping,
    job_repo: JobRepository = Depends(get_job_repository),
    speaker_service: SpeakerService = Depends(get_speaker_service),
    summary_service: SummaryService = Depends(get_summary_service),
    settings: Settings = Depends(get_settings)  # pylint: disable=unused-argument
) -> SpeakerUpdateResponse:
    """Update speaker names in transcript."""
    try:
        job = await job_repo.get(uuid)
        if not job:
            raise HTTPException(status_code=404, detail=f"Job {uuid} not found")

        file_name = job['file_name']
        base_name = os.path.splitext(file_name)[0]

        # Update speaker names
        updated_transcript = await speaker_service.update_speaker_names(
            uuid,
            base_name,
            speaker_map.mapping
        )

        # Invalidate cached summary
        await summary_service.delete_summary(uuid)
        logger.info("Updated speakers for %s, summary cache invalidated", uuid)

        return SpeakerUpdateResponse(
            uuid=uuid,
            status="success",
            message="Speaker names updated successfully",
            transcript=updated_transcript
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error("Error updating speakers for job %s: %s", uuid, e, exc_info=True)
        raise HTTPException(
            status_code=500,
            detail="Internal server error while updating speaker names"
        ) from e
