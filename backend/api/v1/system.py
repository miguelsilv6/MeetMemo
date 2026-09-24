"""
System information endpoint.

Exposes read-only hardware detection and the resolved ML configuration so the
frontend (and operators) can see which hardware profile is active.
"""
import logging

from config import Settings, get_settings
from fastapi import APIRouter, Depends, HTTPException
from services.runtime_settings_service import RuntimeSettingsService

logger = logging.getLogger(__name__)

router = APIRouter()


@router.get("/system")
async def system_info(settings: Settings = Depends(get_settings)):
    """
    Report detected hardware and the resolved ML configuration.

    Returns:
        dict: Detected GPU/VRAM, the resolved hardware profile, the active
        model/precision/device settings, and any fit warnings.
    """
    try:
        info = settings.system_info()
        runtime = await RuntimeSettingsService(settings).get()
        info["whisper_model_name"] = runtime.whisper_model_name
        return info
    except Exception as e:
        logger.error("System info lookup failed: %s", e, exc_info=True)
        raise HTTPException(status_code=500, detail="System info lookup failed") from e


@router.get("/config")
async def public_config(settings: Settings = Depends(get_settings)):
    """Non-sensitive runtime settings the upload screen needs."""
    runtime = await RuntimeSettingsService(settings).get()
    return {"default_language": runtime.default_language}
