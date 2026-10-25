"""
Cue points: marked instants of an audio, with a note (see migrations/012_cue_points.sql).

Every query names the audio as well as the cue point, so a cue point id from
another audio is never read or changed through this one.
"""
from typing import Optional

from database import get_db

# Enough for any review; it keeps one audio from growing without bound.
MAX_CUE_POINTS_PER_JOB = 200

_COLUMNS = "id, position_seconds, note, created_by, created_at, updated_at"


class CuePointLimitError(Exception):
    """The audio already has the most cue points allowed."""


class CuePointRepository:
    """Data access for an audio's cue points."""

    async def list(self, job_uuid: str) -> list[dict]:
        """The audio's cue points, in time order."""
        async with get_db() as conn:
            rows = await conn.fetch(
                f"""SELECT {_COLUMNS} FROM cue_points WHERE job_uuid = $1
                    ORDER BY position_seconds, id""",
                job_uuid,
            )
        return [dict(row) for row in rows]

    async def create(
        self, job_uuid: str, position_seconds: float, note: str, created_by: Optional[str]
    ) -> dict:
        """
        Add a cue point.

        Raises:
            CuePointLimitError: If the audio already has MAX_CUE_POINTS_PER_JOB.
        """
        async with get_db() as conn:
            async with conn.transaction():
                # One add at a time per audio, so two at once cannot pass the limit.
                await conn.execute("SELECT 1 FROM jobs WHERE uuid = $1 FOR UPDATE", job_uuid)
                count = await conn.fetchval(
                    "SELECT COUNT(*) FROM cue_points WHERE job_uuid = $1", job_uuid
                )
                if count >= MAX_CUE_POINTS_PER_JOB:
                    raise CuePointLimitError()
                row = await conn.fetchrow(
                    f"""INSERT INTO cue_points (job_uuid, position_seconds, note, created_by)
                        VALUES ($1, $2, $3, $4) RETURNING {_COLUMNS}""",
                    job_uuid, position_seconds, note, created_by,
                )
        return dict(row)

    async def update_note(self, job_uuid: str, cue_point_id: int, note: str) -> Optional[dict]:
        """Change a cue point's note; None if the audio has no such cue point."""
        async with get_db() as conn:
            row = await conn.fetchrow(
                f"""UPDATE cue_points SET note = $3, updated_at = NOW()
                    WHERE job_uuid = $1 AND id = $2 RETURNING {_COLUMNS}""",
                job_uuid, cue_point_id, note,
            )
        return dict(row) if row else None

    async def delete(self, job_uuid: str, cue_point_id: int) -> bool:
        """Remove a cue point; False if the audio has no such cue point."""
        async with get_db() as conn:
            deleted = await conn.fetchval(
                "DELETE FROM cue_points WHERE job_uuid = $1 AND id = $2 RETURNING id",
                job_uuid, cue_point_id,
            )
        return deleted is not None
