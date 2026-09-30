"""
Projects: several audios processed by the server-side queue and deleted in
full when the project expires or is deleted.
"""
import logging
import os
import uuid as uuid_lib
from typing import Optional

import aiofiles.os
from config import Settings
from database import InsufficientTokensError
from fastapi import HTTPException, UploadFile
from repositories.project_repository import ProjectRepository

from services.job_files import remove_job_files
from services.runtime_settings_service import RuntimeSettingsService

logger = logging.getLogger(__name__)

# Same formats the upload page accepts.
AUDIO_EXTENSIONS = (".mp3", ".wav", ".m4a", ".webm", ".ogg", ".flac", ".aac")
MAX_FILES_PER_UPLOAD = 50

# How each workflow step maps onto an audio's overall progress (0-100).
_STEP_RANGES = {"transcribing": (0, 30), "diarizing": (30, 90), "aligning": (90, 100)}
_STATE_PROGRESS = {"uploaded": 0, "transcribed": 30, "diarized": 90, "completed": 100}
PROCESSING_STATES = frozenset(_STEP_RANGES)


def overall_progress(state: str, step_progress: Optional[int]) -> int:
    """An audio's progress through all three steps, 0-100."""
    if state in _STEP_RANGES:
        start, end = _STEP_RANGES[state]
        step = max(0, min(100, step_progress or 0))
        return start + (end - start) * step // 100
    return _STATE_PROGRESS.get(state, 0)


def audio_status(job: dict, current_job: Optional[str], queue: list[str]) -> dict:
    """What the project page shows for one audio."""
    job_uuid = str(job["uuid"])
    state = job["workflow_state"]
    if state == "completed":
        status = "completed"
    elif state == "error":
        status = "error"
    elif state in PROCESSING_STATES or job_uuid == current_job:
        status = "processing"
    else:
        status = "queued"
    return {
        "uuid": job_uuid,
        "file_name": job["file_name"],
        "status": status,
        "workflow_state": state,
        "progress": overall_progress(state, job.get("current_step_progress")),
        "queue_position": queue.index(job_uuid) + 1 if status == "queued" and job_uuid in queue
        else None,
        "error_message": job.get("error_message") if status == "error" else None,
        "language": job.get("language"),
        # Detected by Whisper, once transcribed (no probability when the
        # language was chosen rather than detected).
        "detected_language": job.get("detected_language"),
        "language_probability": job.get("language_probability"),
        "created_at": job["created_at"],
    }


class ProjectService:
    """Create, fill, process and delete projects."""

    def __init__(
        self,
        settings: Settings,
        repo: Optional[ProjectRepository] = None,
        audio_service=None,
        runtime_settings: Optional[RuntimeSettingsService] = None,
        pipeline=None,
    ):
        self.settings = settings
        self.repo = repo or ProjectRepository()
        self.audio_service = audio_service
        self.runtime_settings = runtime_settings or RuntimeSettingsService(settings)
        self.pipeline = pipeline

    async def process(self, job: dict) -> None:
        """
        Run an audio's remaining steps (the project queue's job runner).

        An audio deleted while it was being processed (by the user or because
        its project expired) can have files written after the deletion; they
        are removed once its steps stop.
        """
        try:
            await self.pipeline.run_remaining(job)
        finally:
            if not await self.repo.job_exists(str(job["uuid"])):
                await remove_job_files(self.settings, str(job["uuid"]), job["file_name"])
                logger.info("Removed files left by deleted audio %s", job["uuid"])

    async def create(
        self, name: str, reference: Optional[str], description: Optional[str], user_uuid: str
    ) -> dict:
        """Create a user's project; its expiry date is fixed now, from the admin setting."""
        runtime = await self.runtime_settings.get()
        project = await self.repo.create(
            str(uuid_lib.uuid4()), name, reference, description,
            runtime.project_retention_days, user_uuid,
        )
        logger.info(
            "Created project %s, expiring %s", project["uuid"], project["expires_at"].isoformat()
        )
        return project

    async def add_audios(
        self, project_uuid: str, files: list[UploadFile], language: Optional[str]
    ) -> list[dict]:
        """
        Store each file and queue it, skipping files already in the project.

        Returns:
            One result per file: {"file_name", "status": "queued" | "duplicate"
            | "no_tokens" | "rejected", "uuid"?, "detail"?}.
        """
        results = []
        for upload in files:
            name = upload.filename or ""
            if not name.lower().endswith(AUDIO_EXTENSIONS):
                results.append({"file_name": name, "status": "rejected",
                                "detail": "Unsupported file type"})
                continue
            try:
                results.append(await self._add_audio(project_uuid, upload, language))
            except HTTPException as e:
                results.append({"file_name": name, "status": "rejected", "detail": e.detail})
            except Exception as e:  # pylint: disable=broad-exception-caught
                logger.error("Could not add %s to project %s: %s", name, project_uuid, e,
                             exc_info=True)
                results.append({"file_name": name, "status": "rejected",
                                "detail": "Could not store or convert the file"})
        return results

    async def _add_audio(
        self, project_uuid: str, upload: UploadFile, language: Optional[str]
    ) -> dict:
        job_uuid = str(uuid_lib.uuid4())
        file_name, file_hash = await self.audio_service.upload_audio(job_uuid, upload)
        file_path = os.path.join(self.settings.upload_dir, file_name)

        existing = await self.repo.find_job_by_hash(project_uuid, file_hash)
        if existing:
            await aiofiles.os.remove(file_path)
            return {"file_name": upload.filename, "status": "duplicate",
                    "uuid": str(existing["uuid"]), "detail": existing["file_name"]}

        if not file_name.lower().endswith(".wav"):
            wav_name = f"{os.path.splitext(file_name)[0]}.wav"
            try:
                await self.audio_service.convert_to_wav_async(file_name, wav_name)
            finally:
                if await aiofiles.os.path.exists(file_path):
                    await aiofiles.os.remove(file_path)
            file_name = wav_name

        try:
            await self.repo.add_job(job_uuid, project_uuid, file_name, file_hash, language)
        except InsufficientTokensError:
            stored = os.path.join(self.settings.upload_dir, file_name)
            if await aiofiles.os.path.exists(stored):
                await aiofiles.os.remove(stored)
            return {"file_name": upload.filename, "status": "no_tokens"}
        logger.info("Queued %s in project %s as job %s", file_name, project_uuid, job_uuid)
        return {"file_name": upload.filename, "status": "queued", "uuid": job_uuid}

    async def delete_audio(self, project_uuid: str, job_uuid: str) -> bool:
        """Delete one audio of the project with every file it produced."""
        files = [f for f in await self.repo.files(project_uuid) if str(f["uuid"]) == job_uuid]
        if not files or not await self.repo.delete_job(project_uuid, job_uuid):
            return False
        await remove_job_files(
            self.settings, job_uuid, files[0]["file_name"], files[0]["export_paths"]
        )
        return True

    async def delete(self, project_uuid: str) -> bool:
        """Delete the project and every file of every audio in it."""
        files = await self.repo.files(project_uuid)
        if not await self.repo.delete(project_uuid):
            return False
        for job in files:
            await remove_job_files(
                self.settings, str(job["uuid"]), job["file_name"], job["export_paths"]
            )
        logger.info("Deleted project %s and its %d audio(s)", project_uuid, len(files))
        return True

    async def delete_expired(self) -> int:
        """Delete every expired project in full. Returns how many were deleted."""
        deleted = 0
        for project_uuid in await self.repo.expired():
            try:
                if await self.delete(project_uuid):
                    deleted += 1
            except Exception as e:  # pylint: disable=broad-exception-caught
                logger.error("Failed to delete expired project %s: %s", project_uuid, e)
        if deleted:
            logger.info("Deleted %d expired project(s)", deleted)
        return deleted
