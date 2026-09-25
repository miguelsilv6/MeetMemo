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
# Segments sent to the LLM per request: small enough for a small model on CPU
# to answer completely and within LLM_TIMEOUT.
TRANSLATION_BLOCK_SIZE = 15


async def _read_json(path: str):
    async with aiofiles.open(path, "r", encoding="utf-8") as f:
        return json.loads(await f.read())


async def _write_json(path: str, data) -> None:
    async with aiofiles.open(path, "w", encoding="utf-8") as f:
        await f.write(json.dumps(data, indent=4, ensure_ascii=False))

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
async def translate_transcript(  # pylint: disable=too-many-locals
    uuid: str,
    request: TranslateRequest = None,
    job_repo: JobRepository = Depends(get_job_repository),
    summary_service: SummaryService = Depends(get_summary_service),
    settings: Settings = Depends(get_settings)
) -> TranslateResponse:
    """Translate a range of transcript segments into European Portuguese.

    Clients translate a long transcript in blocks (`start`/`limit`) so each
    request stays well inside the LLM and proxy timeouts and progress can be
    shown. Translated blocks are saved as they complete, so a retry resumes
    where a failed run stopped; once every segment is translated, the full
    translation is cached. A transcript that is already in Portuguese is
    returned unchanged, without calling the LLM. All translation caches are
    invalidated whenever the transcript text is edited (see `update_transcript`).
    """
    request = request or TranslateRequest()
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

        segments = await _read_json(transcript_path)
        total = len(segments)
        start = min(request.start, total)
        end = total if request.limit is None else min(total, start + request.limit)

        def respond(status: str, translated: list[dict]) -> TranslateResponse:
            return TranslateResponse(
                uuid=uuid,
                status=status,
                status_code=200,
                target_language=TRANSLATION_TARGET,
                segments=translated,
                start=start,
                total=total,
            )

        transcription = await job_repo.get_transcription(uuid)
        if transcription and transcription.get("language") == "pt":
            logger.info("Transcript for job %s is already Portuguese; not translating", uuid)
            return respond("original", segments[start:end])

        # Keyed by the variant, so translations cached before European
        # Portuguese was enforced (`<name>.pt.json`) are not reused.
        cache_path = os.path.join(
            settings.translation_dir, f"{base_name}.{TRANSLATION_TARGET}.json"
        )
        if await aiofiles.os.path.exists(cache_path):
            cached = await _read_json(cache_path)
            if len(cached) == total:
                return respond("cached", cached[start:end])

        # Translated text by segment index, saved after every block.
        partial_path = os.path.join(
            settings.translation_dir, f"{base_name}.{TRANSLATION_TARGET}.partial.json"
        )
        partial: dict[str, str] = (
            await _read_json(partial_path)
            if await aiofiles.os.path.exists(partial_path)
            else {}
        )

        missing = [i for i in range(start, end) if str(i) not in partial]
        os.makedirs(settings.translation_dir, exist_ok=True)
        for offset in range(0, len(missing), TRANSLATION_BLOCK_SIZE):
            block = missing[offset:offset + TRANSLATION_BLOCK_SIZE]
            translated = await summary_service.translate_segments([segments[i] for i in block])
            for index, segment in zip(block, translated):
                partial[str(index)] = segment.get("text", "")
            await _write_json(partial_path, partial)

        if all(str(i) in partial for i in range(total)):
            full = [{**segment, "text": partial[str(i)]} for i, segment in enumerate(segments)]
            await _write_json(cache_path, full)
            if os.path.exists(partial_path):
                os.remove(partial_path)
            logger.info("Generated and cached translation for job %s", uuid)

        return respond(
            "generated" if missing else "cached",
            [{**segments[i], "text": partial[str(i)]} for i in range(start, end)],
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error("Error translating transcript for job %s: %s", uuid, e, exc_info=True)
        raise HTTPException(
            status_code=500,
            detail="Internal server error while translating transcript"
        ) from e
