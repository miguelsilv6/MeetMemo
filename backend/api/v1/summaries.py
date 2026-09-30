"""
Summaries router for AI summary operations.

Summaries are generated in the background (services/llm_tasks.py): asking
for one queues a task the page polls; edits and deletion act on the cache.
"""
import logging

from access import Principal, authorize_path, get_principal, require_request_header
from config import Settings, get_settings
from dependencies import get_job_repository, get_llm_task_repository, get_summary_service
from fastapi import APIRouter, Depends, HTTPException, Request, Response
from models import SummarizeRequest, SummaryResponse, UpdateSummaryRequest
from repositories.job_repository import JobRepository
from repositories.llm_task_repository import LlmTaskRepository
from services.llm_tasks import TranscriptMissingError, read_transcript, task_info, wake_llm_queue
from services.summary_service import SummaryService

logger = logging.getLogger(__name__)

router = APIRouter(dependencies=[Depends(require_request_header), Depends(authorize_path)])


def _unfinished(task):
    """A task still under way, or the failure of the latest one (the page shows it)."""
    return task if task and task["status"] != "done" else None


@router.get("/jobs/{uuid}/summaries", response_model=SummaryResponse)
async def get_summary(
    uuid: str,
    job_repo: JobRepository = Depends(get_job_repository),
    summary_service: SummaryService = Depends(get_summary_service),
    tasks: LlmTaskRepository = Depends(get_llm_task_repository),
) -> SummaryResponse:
    """The cached summary, and/or the state of its task ("none" if never asked)."""
    job = await job_repo.get(uuid)
    if not job:
        raise HTTPException(status_code=404, detail=f"Job {uuid} not found")
    task = await tasks.latest(uuid, "summary")
    cached = await summary_service.get_cached_summary(uuid)
    if cached:
        return SummaryResponse(
            uuid=uuid, file_name=job["file_name"], status="cached", status_code=200,
            summary=cached, task=task_info(_unfinished(task)),
        )
    return SummaryResponse(
        uuid=uuid, file_name=job["file_name"], status=task["status"] if task else "none",
        status_code=200, task=task_info(task),
    )


@router.post("/jobs/{uuid}/summaries", response_model=SummaryResponse)
async def create_summary(
    uuid: str,
    http_request: Request,
    response: Response,
    request: SummarizeRequest = None,
    principal: Principal = Depends(get_principal),
    job_repo: JobRepository = Depends(get_job_repository),
    summary_service: SummaryService = Depends(get_summary_service),
    tasks: LlmTaskRepository = Depends(get_llm_task_repository),
    settings: Settings = Depends(get_settings),
) -> SummaryResponse:
    """Summarize the transcript, in the background.

    A cached summary is returned at once (200), unless ``regenerate`` or
    custom prompts ask for a new one. Otherwise a summary task is queued, or
    the one under way returned (202), and the page polls GET .../summaries.
    """
    request = request or SummarizeRequest()
    job = await job_repo.get(uuid)
    if not job:
        raise HTTPException(status_code=404, detail=f"Job {uuid} not found")
    try:
        await read_transcript(settings, job)
    except TranscriptMissingError as exc:
        raise HTTPException(status_code=404, detail="Transcript not found") from exc

    custom = {
        key: value
        for key, value in (("custom_prompt", request.custom_prompt),
                           ("system_prompt", request.system_prompt))
        if value
    }
    if not custom and not request.regenerate:
        cached = await summary_service.get_cached_summary(uuid)
        if cached:
            return SummaryResponse(
                uuid=uuid, file_name=job["file_name"], status="cached", status_code=200,
                summary=cached,
            )

    task = await tasks.enqueue(uuid, "summary", custom, principal.username)
    wake_llm_queue(http_request)
    response.status_code = 202
    return SummaryResponse(
        uuid=uuid, file_name=job["file_name"], status=task["status"], status_code=202,
        task=task_info(task),
    )


@router.patch("/jobs/{uuid}/summaries")
async def update_summary(
    uuid: str,
    request: UpdateSummaryRequest,
    job_repo: JobRepository = Depends(get_job_repository),
    summary_service: SummaryService = Depends(get_summary_service)
) -> SummaryResponse:
    """Update cached summary with user-edited content."""
    job = await job_repo.get(uuid)
    if not job:
        raise HTTPException(status_code=404, detail=f"Job {uuid} not found")

    # Save updated summary
    await summary_service.save_summary(uuid, request.summary)
    logger.info("Updated summary for %s", uuid)

    return SummaryResponse(
        uuid=uuid,
        file_name=job['file_name'],
        status="updated",
        status_code=200,
        summary=request.summary
    )


@router.delete("/jobs/{uuid}/summaries")
async def delete_summary_cache(
    uuid: str,
    job_repo: JobRepository = Depends(get_job_repository),
    summary_service: SummaryService = Depends(get_summary_service)
):
    """Delete cached summary."""
    job = await job_repo.get(uuid)
    if not job:
        raise HTTPException(status_code=404, detail=f"Job {uuid} not found")

    deleted = await summary_service.delete_summary(uuid)
    if deleted:
        logger.info("Deleted cached summary for %s", uuid)
        return {
            "uuid": uuid,
            "status": "success",
            "message": "Summary deleted successfully"
        }

    raise HTTPException(status_code=404, detail="No cached summary found")
