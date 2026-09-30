"""
Background summary and translation tasks (see migrations/008_llm_tasks.sql).

The table is the queue: a task is claimed by moving it from 'queued' to
'running', and tasks a restart interrupted go back to 'queued'.
"""
import json
from typing import Optional

from database import get_db

_COLUMNS = """t.id, t.job_uuid, t.kind, t.status, t.progress_done, t.progress_total,
              t.params, t.error_code, t.error, t.requested_by, t.created_at,
              t.started_at, t.finished_at,
              CASE WHEN t.status = 'queued' THEN
                  (SELECT COUNT(*) FROM llm_tasks q WHERE q.status = 'queued' AND q.id < t.id)
              END AS queue_position"""


def _task(row) -> Optional[dict]:
    if row is None:
        return None
    task = dict(row)
    task["job_uuid"] = str(task["job_uuid"])
    if isinstance(task["params"], str):
        task["params"] = json.loads(task["params"])
    return task


class LlmTaskRepository:
    """Data access for background LLM tasks."""

    async def enqueue(
        self, job_uuid: str, kind: str, params: Optional[dict], requested_by: Optional[str]
    ) -> dict:
        """Queue a task, or return the one already waiting or running for this audio and kind."""
        async with get_db() as conn:
            row = await conn.fetchrow(
                f"""WITH new AS (
                        INSERT INTO llm_tasks (job_uuid, kind, params, requested_by)
                        VALUES ($1, $2, $3::jsonb, $4)
                        ON CONFLICT (job_uuid, kind) WHERE status IN ('queued', 'running')
                        DO NOTHING
                        RETURNING *
                    )
                    SELECT {_COLUMNS} FROM new t""",
                job_uuid, kind, json.dumps(params or {}), requested_by,
            )
            if row is None:
                row = await conn.fetchrow(
                    f"""SELECT {_COLUMNS} FROM llm_tasks t
                        WHERE t.job_uuid = $1 AND t.kind = $2
                          AND t.status IN ('queued', 'running')""",
                    job_uuid, kind,
                )
        return _task(row)

    async def latest(self, job_uuid: str, kind: str) -> Optional[dict]:
        """The audio's most recent task of this kind, if any."""
        async with get_db() as conn:
            row = await conn.fetchrow(
                f"""SELECT {_COLUMNS} FROM llm_tasks t
                    WHERE t.job_uuid = $1 AND t.kind = $2
                    ORDER BY t.id DESC LIMIT 1""",
                job_uuid, kind,
            )
        return _task(row)

    async def get(self, task_id: int) -> Optional[dict]:
        async with get_db() as conn:
            row = await conn.fetchrow(f"SELECT {_COLUMNS} FROM llm_tasks t WHERE t.id = $1", task_id)
        return _task(row)

    async def claim_next(self) -> Optional[dict]:
        """Start the oldest queued task (marking it running), or None."""
        async with get_db() as conn:
            row = await conn.fetchrow(
                f"""WITH next AS (
                        UPDATE llm_tasks SET status = 'running', started_at = NOW(),
                                             error_code = NULL, error = NULL
                        WHERE id = (SELECT id FROM llm_tasks WHERE status = 'queued'
                                    ORDER BY id LIMIT 1 FOR UPDATE SKIP LOCKED)
                        RETURNING *
                    )
                    SELECT {_COLUMNS} FROM next t"""
            )
        return _task(row)

    async def set_progress(self, task_id: int, done: int, total: int) -> None:
        async with get_db() as conn:
            await conn.execute(
                "UPDATE llm_tasks SET progress_done = $2, progress_total = $3 WHERE id = $1",
                task_id, done, total,
            )

    async def finish(self, task_id: int) -> None:
        async with get_db() as conn:
            await conn.execute(
                """UPDATE llm_tasks SET status = 'done', finished_at = NOW(),
                                        progress_done = progress_total
                   WHERE id = $1""",
                task_id,
            )

    async def fail(self, task_id: int, code: str, message: str) -> None:
        async with get_db() as conn:
            await conn.execute(
                """UPDATE llm_tasks SET status = 'error', finished_at = NOW(),
                                        error_code = $2, error = $3
                   WHERE id = $1""",
                task_id, code, message,
            )

    async def requeue_interrupted(self) -> int:
        """Put tasks a restart left running back in the queue."""
        async with get_db() as conn:
            result = await conn.execute(
                "UPDATE llm_tasks SET status = 'queued', started_at = NULL WHERE status = 'running'"
            )
        return int(result.split()[-1])
