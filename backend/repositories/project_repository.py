"""
Project repository: projects, the audios (jobs) that belong to them, and the
queue of project audios waiting to be processed.
"""
from datetime import datetime
from typing import Optional

from database import get_db

# Workflow states a queued audio can be picked up from, and the step each
# needs next. An audio moves through them until 'completed' or 'error'.
RESUMABLE_STATES = ("uploaded", "transcribed", "diarized")
# States a step leaves an audio in while running. Found at startup, they mean
# the server stopped mid-step, and the audio goes back to where it was.
INTERRUPTED_STATES = {"transcribing": "uploaded", "diarizing": "transcribed", "aligning": "diarized"}

_JOB_COLUMNS = """j.uuid, j.file_name, j.status_code, j.workflow_state, j.current_step_progress,
                  j.error_message, j.language, j.model_name, j.created_at, j.updated_at"""


class ProjectRepository:
    """Data access for projects and their audios."""

    # ------------------------------------------------------------------
    # Projects
    # ------------------------------------------------------------------

    async def create(
        self,
        uuid: str,
        name: str,
        reference: Optional[str],
        description: Optional[str],
        retention_days: int,
    ) -> dict:
        """Create a project that expires `retention_days` from now."""
        async with get_db() as conn:
            row = await conn.fetchrow(
                """INSERT INTO projects (uuid, name, reference, description, expires_at)
                   VALUES ($1, $2, $3, $4, NOW() + INTERVAL '1 day' * $5)
                   RETURNING uuid, name, reference, description, created_at, expires_at""",
                uuid, name, reference, description, retention_days,
            )
        return dict(row)

    async def list_active(self) -> list[dict]:
        """Every unexpired project, newest first, with a count of its audios by state."""
        async with get_db() as conn:
            rows = await conn.fetch(
                """SELECT p.uuid, p.name, p.reference, p.description, p.created_at, p.expires_at,
                          COUNT(j.uuid) AS audio_count,
                          COUNT(j.uuid) FILTER (WHERE j.workflow_state = 'completed')
                              AS completed_count,
                          COUNT(j.uuid) FILTER (WHERE j.workflow_state = 'error')
                              AS error_count
                   FROM projects p
                   LEFT JOIN jobs j ON j.project_uuid = p.uuid
                   WHERE p.expires_at > NOW()
                   GROUP BY p.uuid
                   ORDER BY p.created_at DESC"""
            )
        return [dict(row) for row in rows]

    async def get(self, uuid: str) -> Optional[dict]:
        """One project, or None once it has expired (its deletion may be pending)."""
        async with get_db() as conn:
            row = await conn.fetchrow(
                """SELECT uuid, name, reference, description, created_at, expires_at
                   FROM projects WHERE uuid = $1 AND expires_at > NOW()""",
                uuid,
            )
        return dict(row) if row else None

    async def update(
        self, uuid: str, name: str, reference: Optional[str], description: Optional[str]
    ) -> Optional[dict]:
        """Change a project's details (never its expiry date)."""
        async with get_db() as conn:
            row = await conn.fetchrow(
                """UPDATE projects SET name = $2, reference = $3, description = $4
                   WHERE uuid = $1 AND expires_at > NOW()
                   RETURNING uuid, name, reference, description, created_at, expires_at""",
                uuid, name, reference, description,
            )
        return dict(row) if row else None

    async def files(self, uuid: str) -> list[dict]:
        """Each audio of the project with its file name and export files."""
        async with get_db() as conn:
            rows = await conn.fetch(
                """SELECT j.uuid, j.file_name,
                          COALESCE(
                              ARRAY_AGG(e.file_path) FILTER (WHERE e.file_path IS NOT NULL),
                              '{}'
                          ) AS export_paths
                   FROM jobs j
                   LEFT JOIN export_jobs e ON e.job_uuid = j.uuid
                   WHERE j.project_uuid = $1
                   GROUP BY j.uuid, j.file_name""",
                uuid,
            )
        return [dict(row) for row in rows]

    async def delete(self, uuid: str) -> bool:
        """Delete the project and, by cascade, its audios' rows."""
        async with get_db() as conn:
            result = await conn.execute("DELETE FROM projects WHERE uuid = $1", uuid)
        return result.endswith(" 1")

    async def expired(self, now: Optional[datetime] = None) -> list[str]:
        """UUIDs of the projects past their expiry date."""
        async with get_db() as conn:
            rows = await conn.fetch(
                "SELECT uuid FROM projects WHERE expires_at <= COALESCE($1, NOW())", now
            )
        return [str(row["uuid"]) for row in rows]

    # ------------------------------------------------------------------
    # Audios
    # ------------------------------------------------------------------

    async def jobs(self, uuid: str) -> list[dict]:
        """The project's audios in upload order."""
        async with get_db() as conn:
            rows = await conn.fetch(
                f"""SELECT {_JOB_COLUMNS}
                    FROM jobs j
                    WHERE j.project_uuid = $1
                    ORDER BY j.created_at, j.uuid""",
                uuid,
            )
        return [dict(row) for row in rows]

    async def add_job(
        self,
        uuid: str,
        project_uuid: str,
        file_name: str,
        file_hash: str,
        language: Optional[str],
    ) -> None:
        """Add an uploaded audio to the project; it waits in the queue."""
        async with get_db() as conn:
            await conn.execute(
                """INSERT INTO jobs (uuid, file_name, status_code, file_hash, workflow_state,
                                     language, project_uuid)
                   VALUES ($1, $2, 202, $3, 'uploaded', $4, $5)""",
                uuid, file_name, file_hash, language, project_uuid,
            )

    async def delete_job(self, project_uuid: str, job_uuid: str) -> bool:
        """Delete one audio's row (and, by cascade, its export rows)."""
        async with get_db() as conn:
            result = await conn.execute(
                "DELETE FROM jobs WHERE project_uuid = $1 AND uuid = $2", project_uuid, job_uuid
            )
        return result.endswith(" 1")

    async def job_exists(self, job_uuid: str) -> bool:
        """Whether the audio's row still exists."""
        async with get_db() as conn:
            return bool(await conn.fetchval("SELECT 1 FROM jobs WHERE uuid = $1", job_uuid))

    async def find_job_by_hash(self, project_uuid: str, file_hash: str) -> Optional[dict]:
        """The project's audio with this content hash, if already uploaded."""
        async with get_db() as conn:
            row = await conn.fetchrow(
                f"""SELECT {_JOB_COLUMNS}
                    FROM jobs j
                    WHERE j.project_uuid = $1 AND j.file_hash = $2
                    LIMIT 1""",
                project_uuid, file_hash,
            )
        return dict(row) if row else None

    async def get_job(self, project_uuid: str, job_uuid: str) -> Optional[dict]:
        """One audio of the project, or None."""
        async with get_db() as conn:
            row = await conn.fetchrow(
                f"""SELECT {_JOB_COLUMNS}
                    FROM jobs j
                    WHERE j.project_uuid = $1 AND j.uuid = $2""",
                project_uuid, job_uuid,
            )
        return dict(row) if row else None

    # ------------------------------------------------------------------
    # Queue
    # ------------------------------------------------------------------

    async def next_queued_job(self) -> Optional[dict]:
        """
        The audio to process next: the oldest one with a step still to run,
        across all projects that have not expired.
        """
        async with get_db() as conn:
            row = await conn.fetchrow(
                f"""SELECT {_JOB_COLUMNS}, j.project_uuid
                    FROM jobs j
                    JOIN projects p ON p.uuid = j.project_uuid
                    WHERE j.workflow_state = ANY($1::text[])
                      AND p.expires_at > NOW()
                    ORDER BY j.created_at, j.uuid
                    LIMIT 1""",
                list(RESUMABLE_STATES),
            )
        return dict(row) if row else None

    async def requeue_interrupted(self) -> int:
        """Put audios left mid-step by a restart back before that step."""
        async with get_db() as conn:
            result = await conn.execute(
                """UPDATE jobs SET workflow_state = CASE workflow_state
                        WHEN 'transcribing' THEN 'uploaded'
                        WHEN 'diarizing' THEN 'transcribed'
                        WHEN 'aligning' THEN 'diarized'
                    END,
                    current_step_progress = 0
                   WHERE project_uuid IS NOT NULL
                     AND workflow_state = ANY($1::text[])""",
                list(INTERRUPTED_STATES),
            )
        return int(result.split()[-1])

    async def mark_error(self, job_uuid: str, message: str) -> None:
        """Fail an audio that could not start a step (the steps record their own errors)."""
        async with get_db() as conn:
            await conn.execute(
                """UPDATE jobs SET workflow_state = 'error', status_code = 500,
                                  error_message = $2
                   WHERE uuid = $1 AND workflow_state = ANY($3::text[])""",
                job_uuid, message, list(RESUMABLE_STATES),
            )

    async def retry_job(self, project_uuid: str, job_uuid: str) -> bool:
        """Queue a failed audio again from the start."""
        async with get_db() as conn:
            result = await conn.execute(
                """UPDATE jobs SET workflow_state = 'uploaded', status_code = 202,
                                  current_step_progress = 0, error_message = NULL
                   WHERE project_uuid = $1 AND uuid = $2 AND workflow_state = 'error'""",
                project_uuid, job_uuid,
            )
        return result.endswith(" 1")

    async def queue_order(self) -> list[str]:
        """UUIDs of the audios waiting in the queue, the next to run first."""
        async with get_db() as conn:
            rows = await conn.fetch(
                """SELECT j.uuid
                   FROM jobs j JOIN projects p ON p.uuid = j.project_uuid
                   WHERE j.workflow_state = ANY($1::text[]) AND p.expires_at > NOW()
                   ORDER BY j.created_at, j.uuid""",
                list(RESUMABLE_STATES),
            )
        return [str(row["uuid"]) for row in rows]
