"""
Job repository for data access operations.

This repository wraps database.py functions with a domain-focused interface
for managing transcription jobs.
"""
from typing import Optional

from database import (
    add_job,
    cleanup_old_jobs,
    delete_job,
    get_all_jobs,
    get_db,
    get_diarization_data,
    get_job,
    get_job_by_hash,
    get_jobs_count,
    get_transcription_data,
    save_diarization_data,
    save_transcription_data,
    update_file_name,
    update_status,
    update_step_progress,
    update_workflow_state,
)


class JobRepository:
    """Repository for job data access operations."""

    async def create(
        self,
        uuid: str,
        file_name: str,
        file_hash: Optional[str] = None,
        workflow_state: str = 'uploaded',
        model_name: Optional[str] = None,
        language: Optional[str] = None,
        user_uuid: Optional[str] = None,
        charge: bool = False,
    ) -> None:
        """
        Create a new job.

        Args:
            uuid: Job UUID
            file_name: Uploaded file name
            file_hash: Optional file hash for duplicate detection
            workflow_state: Initial workflow state (default: 'uploaded')
            model_name: Optional Whisper model name
            language: Optional language code for transcription
            user_uuid: The owner
            charge: Pay with one of the owner's tokens, atomically with the insert

        Raises:
            InsufficientTokensError: If ``charge`` and the owner has no token left.
        """
        await add_job(
            uuid, file_name, 200, file_hash, workflow_state, model_name, language, user_uuid,
            charge,
        )

    async def get(self, uuid: str) -> Optional[dict]:
        """
        Get job by UUID.

        Args:
            uuid: Job UUID

        Returns:
            Job data dict or None if not found
        """
        return await get_job(uuid)

    async def get_all(
        self,
        limit: int = 100,
        offset: int = 0,
        user_uuid: Optional[str] = None,
    ) -> tuple[list[dict], int]:
        """
        Get all jobs with pagination.

        Args:
            limit: Maximum number of jobs to return
            offset: Number of jobs to skip
            user_uuid: Only this user's jobs; None for everyone's

        Returns:
            Tuple of (jobs list, total count)
        """
        jobs = await get_all_jobs(limit, offset, user_uuid)
        total = await get_jobs_count(user_uuid)
        return jobs, total

    async def update_workflow_state(
        self,
        uuid: str,
        state: str,
        progress: int = 0
    ) -> None:
        """
        Update job workflow state and progress.

        Args:
            uuid: Job UUID
            state: New workflow state
            progress: Progress percentage (0-100)
        """
        await update_workflow_state(uuid, state, progress)

    async def update_step_progress(self, uuid: str, progress: int) -> None:
        """
        Update current step progress.

        Args:
            uuid: Job UUID
            progress: Progress percentage (0-100)
        """
        await update_step_progress(uuid, progress)

    async def save_transcription(self, uuid: str, data: dict) -> None:
        """
        Save raw transcription data.

        Args:
            uuid: Job UUID
            data: Transcription data from Whisper
        """
        await save_transcription_data(uuid, data)

    async def save_diarization(self, uuid: str, data: dict) -> None:
        """
        Save raw diarization data.

        Args:
            uuid: Job UUID
            data: Diarization data from PyAnnote
        """
        await save_diarization_data(uuid, data)

    async def get_transcription(self, uuid: str) -> Optional[dict]:
        """
        Get raw transcription data.

        Args:
            uuid: Job UUID

        Returns:
            Transcription data or None if not found
        """
        return await get_transcription_data(uuid)

    async def get_diarization(self, uuid: str) -> Optional[dict]:
        """
        Get raw diarization data.

        Args:
            uuid: Job UUID

        Returns:
            Diarization data or None if not found
        """
        return await get_diarization_data(uuid)

    async def reset_for_retranscription(self, uuid: str, language: str) -> Optional[list[str]]:
        """
        Put a completed audio back at the start, to be transcribed again in
        ``language``: its transcription and diarization data, exports and
        summary/translation tasks are dropped, and its token is no longer
        refundable (it paid for the first transcription).

        Returns:
            The paths of the export files to delete, or None if the audio is
            not completed (still processing, failed, or gone).
        """
        async with get_db() as conn:
            async with conn.transaction():
                reset = await conn.fetchval(
                    """UPDATE jobs SET workflow_state = 'uploaded', status_code = 202,
                                      current_step_progress = 0, error_message = NULL,
                                      language = $2, transcription_data = NULL,
                                      diarization_data = NULL, token_refundable = FALSE
                       WHERE uuid = $1 AND workflow_state = 'completed'
                       RETURNING uuid""",
                    uuid, language,
                )
                if reset is None:
                    return None
                exports = await conn.fetch(
                    """DELETE FROM export_jobs WHERE job_uuid = $1
                       RETURNING file_path""",
                    uuid,
                )
                await conn.execute("DELETE FROM llm_tasks WHERE job_uuid = $1", uuid)
        return [row["file_path"] for row in exports if row["file_path"]]

    async def update_file_name(self, uuid: str, new_file_name: str) -> None:
        """
        Update job file name (rename).

        Args:
            uuid: Job UUID
            new_file_name: New file name
        """
        await update_file_name(uuid, new_file_name)

    async def update_status(self, uuid: str, status_code: int) -> None:
        """
        Update job status code.

        Args:
            uuid: Job UUID
            status_code: HTTP status code (200, 500, etc.)
        """
        await update_status(uuid, status_code)

    async def delete(self, uuid: str) -> Optional[str]:
        """
        Delete job and return its file name.

        Args:
            uuid: Job UUID

        Returns:
            File name of deleted job or None if not found
        """
        return await delete_job(uuid)

    async def find_by_hash(self, file_hash: str, user_uuid: str) -> Optional[dict]:
        """
        Find the user's job with this file hash (for duplicate detection).

        Args:
            file_hash: SHA256 file hash
            user_uuid: The owner

        Returns:
            Job data dict or None if not found
        """
        return await get_job_by_hash(file_hash, user_uuid)

    async def cleanup_old(self, max_age_hours: int) -> list[dict]:
        """
        Clean up old jobs older than specified age.

        Args:
            max_age_hours: Maximum age in hours

        Returns:
            List of deleted job dicts
        """
        return await cleanup_old_jobs(max_age_hours)
