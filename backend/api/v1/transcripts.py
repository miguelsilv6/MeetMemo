"""
Transcripts router for transcript operations.

This router handles getting and updating transcript content.
"""
import json
import logging
import os

import aiofiles
from config import Settings, get_settings
from dependencies import get_job_repository, get_summary_service
from fastapi import APIRouter, Depends, HTTPException
from models import TranscriptResponse, TranscriptUpdateRequest, TranslateRequest, TranslateResponse
from repositories.job_repository import JobRepository
from security import sanitize_log_data
from services.summary_service import SummaryService
from utils.file_utils import get_transcript_path

logger = logging.getLogger(__name__)

# Translations always target European Portuguese.
TRANSLATION_TARGET = "pt-PT"

router = APIRouter()


def _invalidate_translation_cache(base_name: str, translation_dir: str) -> None:
    """Remove any cached translations for a transcript after its text changes."""
    if not os.path.isdir(translation_dir):
        return
    prefix = f"{base_name}."
    for entry in os.listdir(translation_dir):
        if entry.startswith(prefix) and entry.endswith(".json"):
            os.remove(os.path.join(translation_dir, entry))


@router.get("/jobs/{uuid}/transcripts", response_model=TranscriptResponse)
async def get_transcript(
    uuid: str,
    job_repo: JobRepository = Depends(get_job_repository),
    settings: Settings = Depends(get_settings)
) -> TranscriptResponse:
    """Get transcript for a job (checks edited version first)."""
    try:
        job = await job_repo.get(uuid)
        if not job:
            raise HTTPException(status_code=404, detail=f"Job {uuid} not found")

        file_name = job['file_name']
        base_name = os.path.splitext(file_name)[0]

        # Detected language + confidence, if transcription has run (unaffected
        # by later manual edits to the transcript text/speakers).
        transcription_data = await job_repo.get_transcription(uuid)
        language = transcription_data.get('language') if transcription_data else None
        language_probability = (
            transcription_data.get('language_probability') if transcription_data else None
        )

        # Check for edited transcript first
        edited_path = os.path.join(settings.transcript_edited_dir, f"{base_name}.json")
        original_path = os.path.join(settings.transcript_dir, f"{base_name}.json")

        if await aiofiles.os.path.exists(edited_path):
            async with aiofiles.open(edited_path, "r", encoding="utf-8") as f:
                full_transcript = await f.read()
            logger.info(
                "Retrieved edited transcript for %s: %s",
                uuid,
                sanitize_log_data(full_transcript)
            )
            return TranscriptResponse(
                uuid=uuid,
                status="exists",
                full_transcript=full_transcript,
                file_name=file_name,
                status_code=200,
                is_edited=True,
                language=language,
                language_probability=language_probability
            )

        if await aiofiles.os.path.exists(original_path):
            async with aiofiles.open(original_path, "r", encoding="utf-8") as f:
                full_transcript = await f.read()
            logger.info(
                "Retrieved original transcript for %s: %s",
                uuid,
                sanitize_log_data(full_transcript)
            )
            return TranscriptResponse(
                uuid=uuid,
                status="exists",
                full_transcript=full_transcript,
                file_name=file_name,
                status_code=200,
                is_edited=False,
                language=language,
                language_probability=language_probability
            )

        raise HTTPException(status_code=404, detail=f"Transcript not found for job {uuid}")

    except HTTPException:
        raise
    except Exception as e:
        logger.error("Error retrieving transcript for job %s: %s", uuid, e, exc_info=True)
        raise HTTPException(
            status_code=500,
            detail="Internal server error while retrieving transcript"
        ) from e


@router.patch("/jobs/{uuid}/transcripts")
async def update_transcript(
    uuid: str,
    request: TranscriptUpdateRequest,
    job_repo: JobRepository = Depends(get_job_repository),
    summary_service: SummaryService = Depends(get_summary_service),
    settings: Settings = Depends(get_settings)
):
    """Update transcript content (creates edited version)."""
    try:
        job = await job_repo.get(uuid)
        if not job:
            raise HTTPException(status_code=404, detail=f"Job {uuid} not found")

        file_name = job['file_name']
        base_name = os.path.splitext(file_name)[0]

        # Save to edited directory
        os.makedirs(settings.transcript_edited_dir, exist_ok=True)
        edited_path = os.path.join(settings.transcript_edited_dir, f"{base_name}.json")

        transcript_json = json.dumps(request.transcript, indent=4)
        async with aiofiles.open(edited_path, "w", encoding="utf-8") as f:
            await f.write(transcript_json)

        # Invalidate cached summary and any cached translations (both are now stale)
        await summary_service.delete_summary(uuid)
        _invalidate_translation_cache(base_name, settings.translation_dir)
        logger.info("Transcript updated for job %s, summary/translation cache invalidated", uuid)

        return {
            "uuid": uuid,
            "status": "success",
            "message": "Transcript updated successfully"
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error("Error updating transcript for job %s: %s", uuid, e, exc_info=True)
        raise HTTPException(
            status_code=500,
            detail="Internal server error while updating transcript"
        ) from e


@router.post("/jobs/{uuid}/transcripts/translate", response_model=TranslateResponse)
async def translate_transcript(
    uuid: str,
    _request: TranslateRequest = None,  # validated only: the target is fixed
    job_repo: JobRepository = Depends(get_job_repository),
    summary_service: SummaryService = Depends(get_summary_service),
    settings: Settings = Depends(get_settings)
) -> TranslateResponse:
    """Translate transcript segments into European Portuguese.

    A transcript that is already in Portuguese is returned unchanged, without
    calling the LLM. Results are cached on disk per transcript, and invalidated
    whenever the transcript text is edited (see `update_transcript`).
    """
    try:
        job = await job_repo.get(uuid)
        if not job:
            raise HTTPException(status_code=404, detail=f"Job {uuid} not found")

        file_name = job['file_name']
        base_name = os.path.splitext(file_name)[0]

        try:
            transcript_path = await get_transcript_path(
                base_name,
                settings.transcript_dir,
                settings.transcript_edited_dir
            )
        except FileNotFoundError as exc:
            raise HTTPException(status_code=404, detail="Transcript not found") from exc

        transcription = await job_repo.get_transcription(uuid)
        if transcription and transcription.get("language") == "pt":
            async with aiofiles.open(transcript_path, "r", encoding="utf-8") as f:
                transcript_json = await f.read()
            logger.info("Transcript for job %s is already Portuguese; not translating", uuid)
            return TranslateResponse(
                uuid=uuid,
                status="original",
                status_code=200,
                target_language=TRANSLATION_TARGET,
                segments=json.loads(transcript_json)
            )

        # Keyed by the variant, so translations cached before European
        # Portuguese was enforced (`<name>.pt.json`) are not reused.
        cache_path = os.path.join(
            settings.translation_dir, f"{base_name}.{TRANSLATION_TARGET}.json"
        )

        if await aiofiles.os.path.exists(cache_path):
            async with aiofiles.open(cache_path, "r", encoding="utf-8") as f:
                cached_json = await f.read()
            logger.info("Returning cached translation for job %s", uuid)
            return TranslateResponse(
                uuid=uuid,
                status="cached",
                status_code=200,
                target_language=TRANSLATION_TARGET,
                segments=json.loads(cached_json)
            )

        async with aiofiles.open(transcript_path, "r", encoding="utf-8") as f:
            transcript_json = await f.read()
        segments = json.loads(transcript_json)

        translated_segments = await summary_service.translate_segments(segments)

        os.makedirs(settings.translation_dir, exist_ok=True)
        async with aiofiles.open(cache_path, "w", encoding="utf-8") as f:
            await f.write(json.dumps(translated_segments, indent=4, ensure_ascii=False))

        logger.info("Generated and cached translation for job %s", uuid)

        return TranslateResponse(
            uuid=uuid,
            status="generated",
            status_code=200,
            target_language=TRANSLATION_TARGET,
            segments=translated_segments
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error("Error translating transcript for job %s: %s", uuid, e, exc_info=True)
        raise HTTPException(
            status_code=500,
            detail="Internal server error while translating transcript"
        ) from e
