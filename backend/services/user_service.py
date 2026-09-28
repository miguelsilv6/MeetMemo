"""
User accounts, managed by the administrator: create, change, reset a
password, and delete an account with every file it produced.
"""
import asyncio
import logging
import uuid as uuid_lib
from typing import Optional

import database
from admin_auth import hash_password
from config import Settings
from repositories.project_repository import ProjectRepository
from repositories.user_repository import UserRepository

from services.job_files import remove_job_files
from services.project_service import ProjectService

logger = logging.getLogger(__name__)


async def _hash(password: str) -> str:
    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(None, hash_password, password)


async def purge_ownerless(settings: Settings) -> int:
    """
    Delete the audios and projects from before users existed, files included,
    then make the owner columns mandatory. Safe to run at every startup.

    Returns:
        How many audios were deleted.
    """
    jobs, projects = await database.ownerless_rows()
    for project_uuid in projects:
        await ProjectService(settings, ProjectRepository()).delete(project_uuid)
    for job in jobs:
        await remove_job_files(settings, str(job["uuid"]), job["file_name"], job["export_paths"])
    await database.require_owners()
    if jobs or projects:
        logger.info(
            "Deleted %d audio(s) and %d project(s) from before user accounts existed",
            len(jobs), len(projects),
        )
    return len(jobs)


class UserService:
    """Account management for the admin panel."""

    def __init__(self, settings: Settings, repo: Optional[UserRepository] = None):
        self.settings = settings
        self.repo = repo or UserRepository()

    async def create(self, username: str, display_name: str, password: str) -> dict:
        """Create an account that must choose its own password on first login."""
        return await self.repo.create(
            str(uuid_lib.uuid4()), username, display_name, await _hash(password)
        )

    async def reset_password(self, user_uuid: str, password: str) -> None:
        """Set a temporary password, sign the user out everywhere."""
        await self.repo.set_password(user_uuid, await _hash(password), must_change=True)

    async def delete(self, user_uuid: str) -> bool:
        """Delete the account and every audio, project and file it owns."""
        if not await self.repo.get(user_uuid):
            return False
        files = await self.repo.owned_files(user_uuid)
        await self.repo.delete_owned(user_uuid)
        for job in files:
            await remove_job_files(
                self.settings, str(job["uuid"]), job["file_name"], job["export_paths"]
            )
        deleted = await self.repo.delete(user_uuid)
        logger.info("Deleted user %s and %d audio(s)", user_uuid, len(files))
        return deleted
