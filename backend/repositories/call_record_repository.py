"""
Call records: the TranslatedPRI.xml of an audio (see migrations/015_call_records.sql).
"""
import json
import logging
from typing import Optional

from database import get_db

logger = logging.getLogger(__name__)

_COLUMNS = "source_name, sha256, data, imported_by, imported_at, history"


def _row(row) -> Optional[dict]:
    if row is None:
        return None
    record = dict(row)
    for key in ("data", "history"):
        if isinstance(record.get(key), str):
            record[key] = json.loads(record[key])
    return record


class CallRecordRepository:
    """Data access for audios' call records."""

    async def get(self, job_uuid: str) -> Optional[dict]:
        """The audio's call record (without the file itself), or None."""
        async with get_db() as conn:
            row = await conn.fetchrow(
                f"SELECT {_COLUMNS} FROM call_records WHERE job_uuid = $1", job_uuid
            )
        return _row(row)

    async def summary(self, job_uuid: str) -> Optional[dict]:
        """The main fields of the audio's call record, or None without one."""
        async with get_db() as conn:
            value = await conn.fetchval(
                "SELECT data->'summary' FROM call_records WHERE job_uuid = $1", job_uuid
            )
        return json.loads(value) if isinstance(value, str) else value

    async def get_content(self, job_uuid: str) -> Optional[tuple[str, bytes]]:
        """The file as imported: (its name, its bytes), or None."""
        async with get_db() as conn:
            row = await conn.fetchrow(
                "SELECT source_name, content FROM call_records WHERE job_uuid = $1", job_uuid
            )
        return (row["source_name"], bytes(row["content"])) if row else None

    async def save(  # pylint: disable=too-many-arguments,too-many-positional-arguments
        self, job_uuid: str, source_name: str, content: bytes, digest: str, data: dict,
        imported_by: Optional[str],
    ) -> dict:
        """
        Keep the audio's call record. One that was there is replaced: its
        name, hash, importer and time go into the history.
        """
        async with get_db() as conn:
            row = await conn.fetchrow(
                f"""INSERT INTO call_records
                        (job_uuid, source_name, content, sha256, data, imported_by)
                    VALUES ($1, $2, $3, $4, $5::jsonb, $6)
                    ON CONFLICT (job_uuid) DO UPDATE SET
                        history = call_records.history || jsonb_build_array(jsonb_build_object(
                            'source_name', call_records.source_name,
                            'sha256', call_records.sha256,
                            'imported_by', call_records.imported_by,
                            'imported_at', call_records.imported_at,
                            'replaced_by', EXCLUDED.imported_by,
                            'replaced_at', NOW())),
                        source_name = EXCLUDED.source_name, content = EXCLUDED.content,
                        sha256 = EXCLUDED.sha256, data = EXCLUDED.data,
                        imported_by = EXCLUDED.imported_by, imported_at = NOW()
                    RETURNING {_COLUMNS}""",
                job_uuid, source_name, content, digest, json.dumps(data), imported_by,
            )
        return _row(row)

    async def summaries(self, job_uuids: list[str]) -> dict[str, dict]:
        """The summary of each of these audios' call records, by UUID (those that have one)."""
        if not job_uuids:
            return {}
        async with get_db() as conn:
            rows = await conn.fetch(
                """SELECT job_uuid, data->'summary' AS summary FROM call_records
                   WHERE job_uuid = ANY($1::uuid[])""",
                job_uuids,
            )
        return {
            str(row["job_uuid"]): (
                json.loads(row["summary"]) if isinstance(row["summary"], str) else row["summary"]
            )
            for row in rows
        }


async def summary_context(job_uuid: str) -> Optional[str]:
    """
    What the AI summary is told about the call (who called whom, when, for
    how long), or None. A summary does not fail for want of it.
    """
    # pylint: disable-next=import-outside-toplevel
    from utils.call_record_text import call_record_prompt

    try:
        return call_record_prompt(await CallRecordRepository().summary(job_uuid)) or None
    except Exception as e:  # pylint: disable=broad-exception-caught
        logger.warning("Could not read the call record of job %s: %s", job_uuid, e)
        return None
