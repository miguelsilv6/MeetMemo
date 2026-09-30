"""
Transcripts router for transcript operations.

This router handles getting and updating transcript content.
"""
import json
import logging
import os
from typing import Optional

import aiofiles
from access import Principal, authorize_path, get_principal, require_request_header
from config import Settings, get_settings
from dependencies import get_job_repository, get_llm_task_repository, get_summary_service
from fastapi import APIRouter, Depends, HTTPException, Request, Response
from models import TranscriptResponse, TranscriptUpdateRequest, TranslateRequest, TranslateResponse
from repositories.job_repository import JobRepository
from repositories.llm_task_repository import LlmTaskRepository
from security import sanitize_log_data
from services.job_files import translation_files
from services.llm_tasks import (
    TRANSLATION_TARGET,
    TranscriptMissingError,
    available_translation,
    task_engine,
    task_info,
    wake_llm_queue,
)
from services.runtime_settings_service import RuntimeSettingsService
from services.summary_service import SummaryService

logger = logging.getLogger(__name__)

router = APIRouter(dependencies=[Depends(require_request_header), Depends(authorize_path)])


def _invalidate_translation_cache(base_name: str, translation_dir: str) -> None:
    """Remove any cached translations for a transcript after its text changes."""
    for path in translation_files(translation_dir, base_name):
        os.remove(path)


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


async def get_translation_engine(settings: Settings = Depends(get_settings)) -> str:
    """The engine the admin panel selects for new translations."""
    return (await RuntimeSettingsService(settings).get()).translation_engine


def _translation_response(
    uuid: str, status: str, segments: list[dict], request: TranslateRequest,
    total: int, engine: str, task: Optional[dict] = None,
) -> TranslateResponse:
    start = min(request.start, total)
    end = total if request.limit is None else min(total, start + request.limit)
    return TranslateResponse(
        uuid=uuid,
        status=status,
        status_code=200,
        target_language=TRANSLATION_TARGET,
        engine=engine,
        segments=segments[start:end],
        start=start,
        total=total,
        task=task_info(task),
    )


async def _translation_state(uuid, job_repo, settings, engine):
    job = await job_repo.get(uuid)
    if not job:
        raise HTTPException(status_code=404, detail=f"Job {uuid} not found")
    try:
        status, segments = await available_translation(settings, job_repo, job, engine)
    except TranscriptMissingError as exc:
        raise HTTPException(status_code=404, detail="Transcript not found") from exc
    return job, status, segments


@router.post("/jobs/{uuid}/transcripts/translate", response_model=TranslateResponse)
async def translate_transcript(
    uuid: str,
    http_request: Request,
    response: Response,
    request: TranslateRequest = None,
    principal: Principal = Depends(get_principal),
    job_repo: JobRepository = Depends(get_job_repository),
    tasks: LlmTaskRepository = Depends(get_llm_task_repository),
    settings: Settings = Depends(get_settings),
    engine: str = Depends(get_translation_engine),
) -> TranslateResponse:
    """Translate the transcript into European Portuguese, in the background.

    A transcript already in Portuguese, or one translated before, is returned
    at once (200; `start`/`limit` select a range). Otherwise a translation
    task is queued, or the one under way returned (202), and the page polls
    GET .../transcripts/translation. The engine is the one the admin panel
    selects (`engine` in the response); each has its own cache. Translations
    are invalidated whenever the transcript text is edited (see
    `update_transcript`).
    """
    request = request or TranslateRequest()
    active = await tasks.latest(uuid, "translation")
    if active and active["status"] in ("queued", "running"):
        engine = task_engine(active)  # rejoin the task under way, whatever its engine
    _, status, segments = await _translation_state(uuid, job_repo, settings, engine)
    if status is not None:
        return _translation_response(uuid, status, segments, request, len(segments), engine)
    task = await tasks.enqueue(uuid, "translation", {"engine": engine}, principal.username)
    wake_llm_queue(http_request)
    response.status_code = 202
    return _translation_response(
        uuid, task["status"], [], request, len(segments), task_engine(task), task
    )


@router.get("/jobs/{uuid}/transcripts/translation", response_model=TranslateResponse)
async def get_translation(
    uuid: str,
    job_repo: JobRepository = Depends(get_job_repository),
    tasks: LlmTaskRepository = Depends(get_llm_task_repository),
    settings: Settings = Depends(get_settings),
    engine: str = Depends(get_translation_engine),
) -> TranslateResponse:
    """The translation if it is ready, else the state of its task ("none" if never asked).

    The latest task's engine is the one reported, unless that task failed
    (the page follows the task it started even if the panel switches engines
    meanwhile); otherwise the selected engine's.
    """
    task = await tasks.latest(uuid, "translation")
    if task and task["status"] != "error":
        engine = task_engine(task)
    _, status, segments = await _translation_state(uuid, job_repo, settings, engine)
    if status is not None:
        # A task that finished is not news; one under way or failed still is.
        unfinished = task if task and task["status"] != "done" else None
        return _translation_response(uuid, status, segments, TranslateRequest(),
                                     len(segments), engine, unfinished)
    return _translation_response(
        uuid, task["status"] if task else "none", [], TranslateRequest(), len(segments),
        engine, task,
    )
