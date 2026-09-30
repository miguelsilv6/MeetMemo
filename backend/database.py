"""Database module for managing jobs using PostgreSQL with async support."""
import json
import logging
import os
from contextlib import asynccontextmanager
from typing import Optional

import asyncpg

logger = logging.getLogger(__name__)

# Global connection pool
_db_pool: Optional[asyncpg.Pool] = None  # pylint: disable=invalid-name


async def init_database():
    """Initialize database connection pool."""
    global _db_pool  # pylint: disable=global-statement

    database_url = os.getenv("DATABASE_URL")
    if not database_url:
        raise ValueError("DATABASE_URL environment variable not set")

    try:
        _db_pool = await asyncpg.create_pool(
            database_url,
            min_size=5,
            max_size=20,
            command_timeout=60
        )
        logger.info("Database connection pool initialized successfully")
    except Exception as e:
        logger.error("Failed to initialize database pool: %s", e, exc_info=True)
        raise


ADMIN_SCHEMA_PATH = os.path.join(
    os.path.dirname(os.path.abspath(__file__)), "migrations", "003_admin_panel.sql"
)


async def ensure_admin_schema():
    """Create the admin-panel tables on databases initialized before they existed."""
    with open(ADMIN_SCHEMA_PATH, encoding="utf-8") as f:
        schema_sql = f.read()
    async with get_db() as conn:
        await conn.execute(schema_sql)
    logger.info("Admin panel schema ensured")


PROJECTS_SCHEMA_PATH = os.path.join(
    os.path.dirname(os.path.abspath(__file__)), "migrations", "004_projects.sql"
)


async def ensure_projects_schema():
    """
    Create the projects table and jobs.project_uuid on older databases.

    Unlike the admin schema this is required: the job queries filter on
    jobs.project_uuid.
    """
    with open(PROJECTS_SCHEMA_PATH, encoding="utf-8") as f:
        schema_sql = f.read()
    async with get_db() as conn:
        await conn.execute(schema_sql)
    logger.info("Projects schema ensured")


USERS_SCHEMA_PATH = os.path.join(
    os.path.dirname(os.path.abspath(__file__)), "migrations", "005_users.sql"
)


async def ensure_users_schema():
    """
    Create the users and sessions tables and the owner columns on older databases.

    Required, like the projects schema: every job query filters by owner.
    The owner columns stay nullable until `require_owners` runs, after the rows
    from before users existed have been deleted with their files.
    """
    with open(USERS_SCHEMA_PATH, encoding="utf-8") as f:
        schema_sql = f.read()
    async with get_db() as conn:
        await conn.execute(schema_sql)
    logger.info("Users schema ensured")


async def ownerless_rows() -> tuple[list[dict], list[str]]:
    """Jobs (with export files) and project UUIDs from before users existed."""
    async with get_db() as conn:
        jobs = await conn.fetch(
            """SELECT j.uuid, j.file_name,
                      COALESCE(
                          ARRAY_AGG(e.file_path) FILTER (WHERE e.file_path IS NOT NULL),
                          '{}'
                      ) AS export_paths
               FROM jobs j
               LEFT JOIN export_jobs e ON e.job_uuid = j.uuid
               WHERE j.user_uuid IS NULL
               GROUP BY j.uuid, j.file_name"""
        )
        projects = await conn.fetch("SELECT uuid FROM projects WHERE user_uuid IS NULL")
    return [dict(row) for row in jobs], [str(row["uuid"]) for row in projects]


async def require_owners() -> None:
    """Delete any remaining ownerless rows and make the owner columns mandatory."""
    async with get_db() as conn:
        async with conn.transaction():
            await conn.execute("DELETE FROM jobs WHERE user_uuid IS NULL")
            await conn.execute("DELETE FROM projects WHERE user_uuid IS NULL")
            await conn.execute("ALTER TABLE jobs ALTER COLUMN user_uuid SET NOT NULL")
            await conn.execute("ALTER TABLE projects ALTER COLUMN user_uuid SET NOT NULL")


TOKENS_SCHEMA_PATHS = [
    os.path.join(os.path.dirname(os.path.abspath(__file__)), "migrations", name)
    for name in ("006_tokens.sql", "007_daily_tokens.sql")
]

DEFAULT_TOKENS_TIMEZONE = "Europe/Lisbon"


async def ensure_tokens_schema(timezone: str = DEFAULT_TOKENS_TIMEZONE):
    """
    Create the token balances, ledger, daily quota and refund trigger on older
    databases, and date the daily quota in ``timezone`` (an IANA name).
    """
    async with get_db() as conn:
        for path in TOKENS_SCHEMA_PATHS:
            with open(path, encoding="utf-8") as f:
                await conn.execute(f.read())
        if not await conn.fetchval(
            "SELECT EXISTS (SELECT 1 FROM pg_timezone_names WHERE name = $1)", timezone
        ):
            logger.error(
                "Unknown TOKENS_TIMEZONE %r; daily tokens use %s",
                timezone, DEFAULT_TOKENS_TIMEZONE,
            )
            timezone = DEFAULT_TOKENS_TIMEZONE
        literal = await conn.fetchval("SELECT quote_literal($1::text)", timezone)
        await conn.execute(
            f"""CREATE OR REPLACE FUNCTION tokens_today() RETURNS DATE AS $$
                    SELECT (NOW() AT TIME ZONE {literal})::date
                $$ LANGUAGE sql STABLE"""
        )
    logger.info("Tokens schema ensured (daily quota in %s)", timezone)


LLM_TASKS_SCHEMA_PATH = os.path.join(
    os.path.dirname(os.path.abspath(__file__)), "migrations", "008_llm_tasks.sql"
)


async def ensure_llm_tasks_schema():
    """Create the background summary/translation task table on older databases."""
    with open(LLM_TASKS_SCHEMA_PATH, encoding="utf-8") as f:
        schema_sql = f.read()
    async with get_db() as conn:
        await conn.execute(schema_sql)
    logger.info("LLM tasks schema ensured")


class InsufficientTokensError(Exception):
    """The user has no token left for another transcription."""


async def charge_token(conn, user_uuid: str, job_uuid: str) -> str:
    """
    Take one token from the user for a job, inside the caller's transaction:
    from today's quota while it lasts, otherwise from the extra balance.

    Each check and debit is one statement, so concurrent uploads can never
    spend more tokens than the user has.

    Returns:
        Where the token came from: ``"daily"`` or ``"balance"``.

    Raises:
        InsufficientTokensError: If the day's quota and the balance are both used up.
    """
    daily = await conn.fetchrow(
        """UPDATE users SET
               daily_tokens_used = CASE WHEN daily_tokens_day = d.today
                                        THEN daily_tokens_used + 1 ELSE 1 END,
               daily_tokens_day = d.today
           FROM (SELECT tokens_today() AS today) d
           WHERE uuid = $1
             AND CASE WHEN daily_tokens_day = d.today THEN daily_tokens_used ELSE 0 END
                 < COALESCE(daily_token_quota, default_daily_tokens())
           RETURNING token_balance, d.today""",
        user_uuid,
    )
    if daily is not None:
        await conn.execute(
            """INSERT INTO token_transactions
                   (user_uuid, delta, balance_after, reason, job_uuid, actor, pool, quota_day)
               VALUES ($1, -1, $2, 'charge', $3, (SELECT username FROM users WHERE uuid = $1),
                       'daily', $4)""",
            user_uuid, daily["token_balance"], job_uuid, daily["today"],
        )
        return "daily"

    balance = await conn.fetchval(
        """UPDATE users SET token_balance = token_balance - 1
           WHERE uuid = $1 AND token_balance >= 1
           RETURNING token_balance""",
        user_uuid,
    )
    if balance is None:
        raise InsufficientTokensError(user_uuid)
    await conn.execute(
        """INSERT INTO token_transactions (user_uuid, delta, balance_after, reason, job_uuid, actor)
           VALUES ($1, -1, $2, 'charge', $3, (SELECT username FROM users WHERE uuid = $1))""",
        user_uuid, balance, job_uuid,
    )
    return "balance"


async def refund_queued(conn, where_sql: str, *args) -> int:
    """
    Refund the tokens of audios still waiting (never processed) that are about
    to be deleted, inside the caller's transaction. ``where_sql`` selects the
    jobs, with ``args`` as its parameters.

    Returns:
        How many tokens were refunded.
    """
    return await conn.fetchval(
        f"""SELECT COUNT(*) FILTER (WHERE refunded)
            FROM (SELECT refund_job_charge(uuid, 'system', 'Deleted before processing')
                         AS refunded
                  FROM jobs
                  WHERE workflow_state = 'uploaded' AND ({where_sql})) r""",
        *args,
    )


async def close_database():
    """Close database connection pool."""
    global _db_pool  # pylint: disable=global-statement,global-variable-not-assigned
    if _db_pool:
        await _db_pool.close()
        logger.info("Database connection pool closed")


@asynccontextmanager
async def get_db():
    """Get database connection from pool."""
    if not _db_pool:
        raise RuntimeError("Database pool not initialized. Call init_database() first.")

    async with _db_pool.acquire() as connection:
        yield connection


# ============================================================================
# Jobs table functions
# ============================================================================

async def add_job(
    uuid: str,
    file_name: str,
    status_code: int,
    file_hash: Optional[str] = None,
    workflow_state: str = 'uploaded',
    model_name: Optional[str] = None,
    language: Optional[str] = None,
    user_uuid: Optional[str] = None,
    charge: bool = False,
) -> None:
    """
    Add new job to database with workflow state.

    With ``charge``, one of the owner's tokens pays for it in the same
    transaction: no token, no job (InsufficientTokensError).
    """
    async with get_db() as conn:
        async with conn.transaction():
            if charge:
                await charge_token(conn, user_uuid, uuid)
            await conn.execute(
                """INSERT INTO jobs (uuid, file_name, status_code, file_hash, workflow_state,
                                     model_name, language, user_uuid)
                   VALUES ($1, $2, $3, $4, $5, $6, $7, $8)""",
                uuid, file_name, status_code, file_hash, workflow_state, model_name, language,
                user_uuid
            )
    hash_preview = file_hash[:16] if file_hash else 'None'
    logger.info(
        "Added job %s with file %s (hash: %s...) state: %s, model: %s, language: %s",
        uuid, file_name, hash_preview, workflow_state, model_name, language
    )


async def update_status(uuid: str, new_status: int) -> None:
    """Update job status."""
    async with get_db() as conn:
        await conn.execute(
            """UPDATE jobs
               SET status_code = $1
               WHERE uuid = $2""",
            new_status, uuid
        )
    logger.debug("Updated status for job %s to %s", uuid, new_status)


async def update_progress(uuid: str, progress: int, stage: str) -> None:
    """Update job progress and processing stage."""
    async with get_db() as conn:
        await conn.execute(
            """UPDATE jobs
               SET progress_percentage = $1, processing_stage = $2
               WHERE uuid = $3""",
            progress, stage, uuid
        )
    logger.debug("Updated progress for job %s to %s%% (%s)", uuid, progress, stage)


async def update_error(uuid: str, error_message: str) -> None:
    """Update job with error message and set status to 500."""
    async with get_db() as conn:
        await conn.execute(
            """UPDATE jobs
               SET status_code = 500, error_message = $1
               WHERE uuid = $2""",
            error_message, uuid
        )
    logger.error("Job %s failed with error: %s", uuid, error_message)


async def get_job(uuid: str) -> Optional[dict]:
    """Get job by UUID."""
    async with get_db() as conn:
        row = await conn.fetchrow(
            """SELECT uuid, file_name, status_code, processing_stage, error_message,
                      file_hash, workflow_state, current_step_progress,
                      transcription_data, diarization_data, model_name, language, created_at,
                      project_uuid, user_uuid
               FROM jobs WHERE uuid = $1""",
            uuid
        )
        return dict(row) if row else None


async def get_all_jobs(
    limit: int = 100, offset: int = 0, user_uuid: Optional[str] = None
) -> list[dict]:
    """Jobs outside projects, newest first: one user's, or everyone's for None."""
    async with get_db() as conn:
        rows = await conn.fetch(
            """SELECT j.uuid, j.file_name, j.status_code, j.workflow_state,
                      j.current_step_progress, j.processing_stage, j.error_message,
                      j.created_at, j.user_uuid, u.username AS owner
               FROM jobs j LEFT JOIN users u ON u.uuid = j.user_uuid
               WHERE j.project_uuid IS NULL
                 AND ($3::uuid IS NULL OR j.user_uuid = $3::uuid)
               ORDER BY j.created_at DESC
               LIMIT $1 OFFSET $2""",
            limit, offset, user_uuid
        )
        return [dict(row) for row in rows]


async def get_jobs_count(user_uuid: Optional[str] = None) -> int:
    """Number of jobs outside any project: one user's, or everyone's for None."""
    async with get_db() as conn:
        count = await conn.fetchval(
            """SELECT COUNT(*) FROM jobs
               WHERE project_uuid IS NULL AND ($1::uuid IS NULL OR user_uuid = $1::uuid)""",
            user_uuid,
        )
        return count


async def get_export_paths(uuid: str) -> list[str]:
    """Paths of the export files generated for a job."""
    async with get_db() as conn:
        rows = await conn.fetch(
            "SELECT file_path FROM export_jobs WHERE job_uuid = $1 AND file_path IS NOT NULL",
            uuid
        )
        return [row['file_path'] for row in rows]


async def delete_job(uuid: str) -> Optional[str]:
    """Delete job from database and return file_name if found."""
    async with get_db() as conn:
        # Get file_name before deleting
        row = await conn.fetchrow(
            "SELECT file_name FROM jobs WHERE uuid = $1",
            uuid
        )

        if not row:
            return None

        file_name = row['file_name']

        # Delete the job (CASCADE will delete export_jobs); a job never
        # processed gets its token back.
        async with conn.transaction():
            await refund_queued(conn, "uuid = $1", uuid)
            await conn.execute("DELETE FROM jobs WHERE uuid = $1", uuid)

        logger.info("Deleted job %s with file %s", uuid, file_name)
        return file_name


async def update_file_name(uuid: str, new_file_name: str) -> bool:
    """Update job file name."""
    async with get_db() as conn:
        result = await conn.execute(
            """UPDATE jobs
               SET file_name = $1
               WHERE uuid = $2""",
            new_file_name, uuid
        )
        # result is like "UPDATE 1" or "UPDATE 0"
        success = result.split()[-1] != "0"

    if success:
        logger.info("Updated file name for job %s to %s", uuid, new_file_name)

    return success


async def cleanup_old_jobs(max_age_hours: int = 12) -> list[dict]:
    """
    Find and delete jobs older than max_age_hours.
    Returns list of deleted jobs with their file_names and export files.

    Jobs in a project are left alone: they live until their project expires.
    """
    async with get_db() as conn:
        # Find old jobs
        rows = await conn.fetch(
            """SELECT j.uuid, j.file_name,
                      COALESCE(
                          ARRAY_AGG(e.file_path) FILTER (WHERE e.file_path IS NOT NULL),
                          '{}'
                      ) AS export_paths
               FROM jobs j
               LEFT JOIN export_jobs e ON e.job_uuid = j.uuid
               WHERE j.project_uuid IS NULL
                 AND j.created_at < NOW() - INTERVAL '1 hour' * $1
               GROUP BY j.uuid, j.file_name""",
            max_age_hours
        )
        old_jobs = [dict(row) for row in rows]

        if old_jobs:
            # Delete old jobs
            uuids = [job['uuid'] for job in old_jobs]
            async with conn.transaction():
                await refund_queued(conn, "uuid = ANY($1::uuid[])", uuids)
                await conn.execute(
                    "DELETE FROM jobs WHERE uuid = ANY($1::uuid[])",
                    uuids
                )

            logger.info("Cleaned up %s jobs older than %s hours", len(old_jobs), max_age_hours)

        return old_jobs


# ============================================================================
# Export jobs table functions
# ============================================================================

async def add_export_job(
    export_uuid: str,
    job_uuid: str,
    export_type: str,
    status_code: int
) -> None:
    """Add new export job to database."""
    async with get_db() as conn:
        await conn.execute(
            """INSERT INTO export_jobs (uuid, job_uuid, export_type, status_code)
               VALUES ($1, $2, $3, $4)""",
            export_uuid, job_uuid, export_type, status_code
        )
    logger.info("Added export job %s for job %s (%s)", export_uuid, job_uuid, export_type)


async def get_export_job(uuid: str) -> Optional[dict]:
    """Get export job by UUID."""
    async with get_db() as conn:
        row = await conn.fetchrow(
            """SELECT uuid, job_uuid, export_type, status_code, progress_percentage,
                      error_message, file_path
               FROM export_jobs WHERE uuid = $1""",
            uuid
        )
        return dict(row) if row else None


async def update_export_status(uuid: str, status_code: int) -> None:
    """Update export job status."""
    async with get_db() as conn:
        await conn.execute(
            """UPDATE export_jobs
               SET status_code = $1
               WHERE uuid = $2""",
            status_code, uuid
        )
    logger.debug("Updated export job %s status to %s", uuid, status_code)


async def update_export_progress(uuid: str, progress: int) -> None:
    """Update export job progress."""
    async with get_db() as conn:
        await conn.execute(
            """UPDATE export_jobs
               SET progress_percentage = $1
               WHERE uuid = $2""",
            progress, uuid
        )
    logger.debug("Updated export job %s progress to %s%%", uuid, progress)


async def update_export_error(uuid: str, error_message: str) -> None:
    """Update export job with error message and set status to 500."""
    async with get_db() as conn:
        await conn.execute(
            """UPDATE export_jobs
               SET status_code = 500, error_message = $1
               WHERE uuid = $2""",
            error_message, uuid
        )
    logger.error("Export job %s failed with error: %s", uuid, error_message)


async def update_export_file_path(uuid: str, file_path: str) -> None:
    """Update export job file path."""
    async with get_db() as conn:
        await conn.execute(
            """UPDATE export_jobs
               SET file_path = $1
               WHERE uuid = $2""",
            file_path, uuid
        )
    logger.debug("Updated export job %s file path to %s", uuid, file_path)


async def cleanup_old_export_jobs(max_age_hours: int = 24) -> list[dict]:
    """
    Find and delete export jobs older than max_age_hours.
    Returns list of deleted export jobs.
    """
    async with get_db() as conn:
        # Find old export jobs
        rows = await conn.fetch(
            """SELECT uuid, job_uuid, export_type, file_path
               FROM export_jobs
               WHERE created_at < NOW() - INTERVAL '1 hour' * $1""",
            max_age_hours
        )
        old_exports = [dict(row) for row in rows]

        if old_exports:
            # Delete old export jobs
            uuids = [export['uuid'] for export in old_exports]
            await conn.execute(
                "DELETE FROM export_jobs WHERE uuid = ANY($1::uuid[])",
                uuids
            )

            logger.info(
                "Cleaned up %s export jobs older than %s hours",
                len(old_exports), max_age_hours
            )

        return old_exports


# ============================================================================
# File hash functions for duplicate detection
# ============================================================================

async def get_job_by_hash(file_hash: str, user_uuid: str) -> Optional[dict]:
    """
    Find existing job by file hash.
    Returns the user's most recent job with the given hash outside any project
    (a project's audios are private to it, and each user's to them).
    """
    async with get_db() as conn:
        row = await conn.fetchrow(
            """SELECT uuid, file_name, status_code, processing_stage, error_message,
                      file_hash, created_at, workflow_state, current_step_progress
               FROM jobs
               WHERE file_hash = $1 AND project_uuid IS NULL AND user_uuid = $2
               ORDER BY created_at DESC
               LIMIT 1""",
            file_hash, user_uuid
        )
        return dict(row) if row else None


# ============================================================================
# Workflow state management functions
# ============================================================================

async def update_workflow_state(uuid: str, new_state: str, progress: int = 0) -> None:
    """Update job workflow state and reset step progress."""
    async with get_db() as conn:
        await conn.execute(
            """UPDATE jobs
               SET workflow_state = $1, current_step_progress = $2
               WHERE uuid = $3""",
            new_state, progress, uuid
        )
    logger.debug("Updated workflow state for job %s to %s (%s%%)", uuid, new_state, progress)


async def update_step_progress(uuid: str, progress: int) -> None:
    """Update progress for current workflow step."""
    async with get_db() as conn:
        await conn.execute(
            """UPDATE jobs
               SET current_step_progress = $1
               WHERE uuid = $2""",
            progress, uuid
        )
    logger.debug("Updated step progress for job %s to %s%%", uuid, progress)


async def save_transcription_data(uuid: str, transcription_data: dict) -> None:
    """Save raw transcription data from Whisper."""
    async with get_db() as conn:
        await conn.execute(
            """UPDATE jobs
               SET transcription_data = $1
               WHERE uuid = $2""",
            json.dumps(transcription_data), uuid
        )
    logger.info("Saved transcription data for job %s", uuid)


async def save_diarization_data(uuid: str, diarization_data: dict) -> None:
    """Save raw diarization data from PyAnnote."""
    async with get_db() as conn:
        await conn.execute(
            """UPDATE jobs
               SET diarization_data = $1
               WHERE uuid = $2""",
            json.dumps(diarization_data), uuid
        )
    logger.info("Saved diarization data for job %s", uuid)


async def get_transcription_data(uuid: str) -> Optional[dict]:
    """Get raw transcription data for a job."""
    async with get_db() as conn:
        row = await conn.fetchrow(
            """SELECT transcription_data FROM jobs WHERE uuid = $1""",
            uuid
        )
        if row and row['transcription_data']:
            return json.loads(row['transcription_data'])
        return None


async def get_diarization_data(uuid: str) -> Optional[dict]:
    """Get raw diarization data for a job."""
    async with get_db() as conn:
        row = await conn.fetchrow(
            """SELECT diarization_data FROM jobs WHERE uuid = $1""",
            uuid
        )
        if row and row['diarization_data']:
            return json.loads(row['diarization_data'])
        return None
