"""
Cue points router: instants of an audio a reviewer marked to come back to.

Only the audio's owner (or the administrator) reaches these routes, through
the same path guard as the audio's other routes.
"""
from typing import Annotated

from access import Principal, authorize_path, get_principal, require_request_header
from dependencies import get_cue_point_repository
from fastapi import APIRouter, Depends, HTTPException, Path, Response
from models import CuePoint, CuePointCreateRequest, CuePointUpdateRequest
from repositories.cue_point_repository import (
    MAX_CUE_POINTS_PER_JOB,
    CuePointLimitError,
    CuePointRepository,
)

# A cue point id in the path: a BIGSERIAL value.
CuePointId = Annotated[int, Path(ge=1, le=2**63 - 1)]

router = APIRouter(dependencies=[Depends(require_request_header), Depends(authorize_path)])


@router.get("/jobs/{uuid}/cue-points", response_model=list[CuePoint])
async def list_cue_points(
    uuid: str, repo: CuePointRepository = Depends(get_cue_point_repository)
) -> list[dict]:
    """The audio's cue points, in time order."""
    return await repo.list(uuid)


@router.post("/jobs/{uuid}/cue-points", response_model=CuePoint, status_code=201)
async def create_cue_point(
    uuid: str,
    request: CuePointCreateRequest,
    principal: Principal = Depends(get_principal),
    repo: CuePointRepository = Depends(get_cue_point_repository),
) -> dict:
    """Mark an instant of the audio, with an optional note."""
    try:
        return await repo.create(
            uuid, request.position_seconds, request.note.strip(), principal.username
        )
    except CuePointLimitError as e:
        raise HTTPException(
            status_code=409,
            detail=f"An audio can have at most {MAX_CUE_POINTS_PER_JOB} cue points",
        ) from e


@router.patch("/jobs/{uuid}/cue-points/{cue_point_id}", response_model=CuePoint)
async def update_cue_point(
    uuid: str,
    cue_point_id: CuePointId,
    request: CuePointUpdateRequest,
    repo: CuePointRepository = Depends(get_cue_point_repository),
) -> dict:
    """Change a cue point's note."""
    updated = await repo.update_note(uuid, cue_point_id, request.note.strip())
    if updated is None:
        raise HTTPException(status_code=404, detail="Cue point not found")
    return updated


@router.delete("/jobs/{uuid}/cue-points/{cue_point_id}", status_code=204)
async def delete_cue_point(
    uuid: str,
    cue_point_id: CuePointId,
    repo: CuePointRepository = Depends(get_cue_point_repository),
) -> Response:
    """Remove a cue point."""
    if not await repo.delete(uuid, cue_point_id):
        raise HTTPException(status_code=404, detail="Cue point not found")
    return Response(status_code=204)
