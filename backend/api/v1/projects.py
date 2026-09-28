"""
Projects router: group several audios under one case, process them with the
server-side queue, and delete everything when the project expires.
"""
import logging
from typing import Optional
from uuid import UUID

from access import (
    Principal,
    authorize_path,
    get_principal,
    require_request_header,
    require_user,
)
from config import Settings, get_settings
from dependencies import get_audio_service, get_project_repository
from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, Response, UploadFile
from pydantic import BaseModel, Field, field_validator
from repositories.project_repository import ProjectRepository
from runtime_settings import AUTO_DETECT, WHISPER_LANGUAGE_CODES
from services.project_service import MAX_FILES_PER_UPLOAD, ProjectService, audio_status
from services.runtime_settings_service import RuntimeSettingsService

logger = logging.getLogger(__name__)

router = APIRouter(dependencies=[Depends(require_request_header), Depends(authorize_path)])


class ProjectRequest(BaseModel):
    """A project's editable details."""

    name: str = Field(min_length=1, max_length=200)
    reference: Optional[str] = Field(default=None, max_length=100)
    description: Optional[str] = Field(default=None, max_length=2000)

    @field_validator("name", "reference", "description", mode="before")
    @classmethod
    def _strip(cls, value):
        if isinstance(value, str):
            value = value.strip()
            return value or None
        return value


def get_project_service(
    settings: Settings = Depends(get_settings),
    repo: ProjectRepository = Depends(get_project_repository),
    audio_service=Depends(get_audio_service),
) -> ProjectService:
    """ProjectService dependency."""
    return ProjectService(settings, repo, audio_service)


def _queue(request: Request):
    """The running project queue, if the app started one."""
    return getattr(request.app.state, "project_queue", None)


async def _project_or_404(repo: ProjectRepository, project_uuid: UUID) -> dict:
    project = await repo.get(project_uuid)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    return project


@router.get("/projects")
async def list_projects(
    principal: Principal = Depends(get_principal),
    repo: ProjectRepository = Depends(get_project_repository),
    settings: Settings = Depends(get_settings),
) -> dict:
    """The caller's unexpired projects (everyone's for the administrator), newest first."""
    runtime = await RuntimeSettingsService(settings).get()
    owner = None if principal.is_admin else principal.user_uuid
    return {
        "projects": await repo.list_active(owner),
        "retention_days": runtime.project_retention_days,
    }


@router.post("/projects", status_code=201)
async def create_project(
    body: ProjectRequest,
    principal: Principal = Depends(require_user),
    service: ProjectService = Depends(get_project_service),
) -> dict:
    """Create a project; it expires after the retention set in the admin panel."""
    return await service.create(
        body.name, body.reference, body.description, principal.user_uuid
    )


@router.get("/projects/{project_uuid}")
async def get_project(
    project_uuid: UUID,
    request: Request,
    repo: ProjectRepository = Depends(get_project_repository),
) -> dict:
    """A project with the status of each of its audios."""
    project = await _project_or_404(repo, project_uuid)
    queue = _queue(request)
    current = queue.current_job if queue else None
    order = [job for job in await repo.queue_order() if job != current]
    audios = [audio_status(job, current, order) for job in await repo.jobs(project_uuid)]
    return {**project, "audios": audios}


@router.patch("/projects/{project_uuid}")
async def update_project(
    project_uuid: UUID,
    body: ProjectRequest,
    repo: ProjectRepository = Depends(get_project_repository),
) -> dict:
    """Change a project's name, reference or description (not its expiry)."""
    project = await repo.update(project_uuid, body.name, body.reference, body.description)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    return project


@router.delete("/projects/{project_uuid}", status_code=204)
async def delete_project(
    project_uuid: UUID,
    repo: ProjectRepository = Depends(get_project_repository),
    service: ProjectService = Depends(get_project_service),
) -> Response:
    """Delete the project and every file of every audio in it."""
    await _project_or_404(repo, project_uuid)
    await service.delete(str(project_uuid))
    return Response(status_code=204)


@router.post("/projects/{project_uuid}/audios")
async def add_audios(  # pylint: disable=too-many-arguments,too-many-positional-arguments
    project_uuid: UUID,
    request: Request,
    files: list[UploadFile] = File(...),
    language: Optional[str] = Form(default=None),
    _user: Principal = Depends(require_user),
    repo: ProjectRepository = Depends(get_project_repository),
    service: ProjectService = Depends(get_project_service),
) -> dict:
    """
    Upload audios to the project. Each is queued for processing on the
    server, unless the project already has the same file.
    """
    await _project_or_404(repo, project_uuid)
    if len(files) > MAX_FILES_PER_UPLOAD:
        raise HTTPException(
            status_code=400, detail=f"At most {MAX_FILES_PER_UPLOAD} files per upload"
        )
    language = language or None
    if language not in (None, AUTO_DETECT) and language not in WHISPER_LANGUAGE_CODES:
        raise HTTPException(status_code=400, detail=f"Unsupported language: {language}")

    results = await service.add_audios(str(project_uuid), files, language)
    queue = _queue(request)
    if queue and any(r["status"] == "queued" for r in results):
        queue.notify()
    return {"results": results}


@router.post("/projects/{project_uuid}/audios/{job_uuid}/retry", status_code=204)
async def retry_audio(
    project_uuid: UUID,
    job_uuid: UUID,
    request: Request,
    repo: ProjectRepository = Depends(get_project_repository),
) -> Response:
    """Queue an audio that failed again, from the start."""
    await _project_or_404(repo, project_uuid)
    if not await repo.retry_job(project_uuid, job_uuid):
        raise HTTPException(status_code=409, detail="Only a failed audio can be retried")
    queue = _queue(request)
    if queue:
        queue.notify()
    return Response(status_code=204)


@router.delete("/projects/{project_uuid}/audios/{job_uuid}", status_code=204)
async def delete_audio(
    project_uuid: UUID,
    job_uuid: UUID,
    repo: ProjectRepository = Depends(get_project_repository),
    service: ProjectService = Depends(get_project_service),
) -> Response:
    """Delete one audio of the project with every file it produced."""
    await _project_or_404(repo, project_uuid)
    if not await service.delete_audio(str(project_uuid), str(job_uuid)):
        raise HTTPException(status_code=404, detail="Audio not found in this project")
    return Response(status_code=204)
