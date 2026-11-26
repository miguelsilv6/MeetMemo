"""
Call records router: the TranslatedPRI.xml of an intercepted audio.

Only the audio's owner (or the administrator) reaches these routes, through
the same path guard as the audio's other routes. The file is kept as
imported (with its SHA-256) and can be downloaded again; replacing it keeps
the replaced one's hash in the record's history.
"""
import logging
import os
from urllib.parse import quote

from access import Principal, authorize_path, get_principal, require_request_header
from dependencies import get_call_record_repository, get_job_repository
from fastapi import APIRouter, Depends, File, HTTPException, Response, UploadFile
from repositories.call_record_repository import CallRecordRepository
from repositories.job_repository import JobRepository
from services.call_record import (
    FILE_NAME,
    MAX_BYTES,
    CallRecordError,
    guid_matches_audio,
    parse_call_record,
    sha256,
)

logger = logging.getLogger(__name__)

router = APIRouter(dependencies=[Depends(require_request_header), Depends(authorize_path)])


def _with_match(record: dict, job: dict) -> dict:
    """The record as the page shows it: whether its GUID names the audio."""
    guid = (record.get("data") or {}).get("summary", {}).get("guid")
    return {**record, "guid_matches_audio": guid_matches_audio(guid, job["file_name"])}


@router.get("/jobs/{uuid}/call-record")
async def get_call_record(
    uuid: str,
    records: CallRecordRepository = Depends(get_call_record_repository),
    jobs: JobRepository = Depends(get_job_repository),
) -> dict:
    """The audio's call record: its fields, and who imported which file when."""
    record = await records.get(uuid)
    if record is None:
        raise HTTPException(status_code=404, detail="This audio has no call record")
    return _with_match(record, await jobs.get(uuid))


@router.put("/jobs/{uuid}/call-record")
async def put_call_record(
    uuid: str,
    file: UploadFile = File(...),
    principal: Principal = Depends(get_principal),
    records: CallRecordRepository = Depends(get_call_record_repository),
    jobs: JobRepository = Depends(get_job_repository),
) -> dict:
    """Import the audio's TranslatedPRI.xml (replacing the one it had, if any)."""
    content = await file.read(MAX_BYTES + 1)
    try:
        data = parse_call_record(content)
    except CallRecordError as e:
        raise HTTPException(status_code=422, detail=str(e)) from e
    # Only the name, not a path the browser may send.
    source_name = os.path.basename((file.filename or FILE_NAME).replace("\\", "/"))[:255]
    digest = sha256(content)
    current = await records.get(uuid)
    if current is not None and current["sha256"] == digest:
        return _with_match(current, await jobs.get(uuid))  # the same file again: nothing changes
    record = await records.save(
        uuid, source_name or FILE_NAME, content, digest, data, principal.username
    )
    logger.info(
        "Call record %s (sha256 %s) imported for job %s by %s",
        source_name, digest, uuid, principal.username,
    )
    return _with_match(record, await jobs.get(uuid))


@router.get("/jobs/{uuid}/call-record/file")
async def download_call_record(
    uuid: str, records: CallRecordRepository = Depends(get_call_record_repository)
) -> Response:
    """The call record's file, exactly as it was imported."""
    stored = await records.get_content(uuid)
    if stored is None:
        raise HTTPException(status_code=404, detail="This audio has no call record")
    name, content = stored
    return Response(
        content=content,
        media_type="application/xml",
        headers={"Content-Disposition": f"attachment; filename*=UTF-8''{quote(name)}"},
    )
