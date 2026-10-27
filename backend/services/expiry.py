"""
When audios and projects are deleted, and how far the administrator may
extend that.

An audio outside a project is deleted `job_retention_hours` (admin panel)
after it was uploaded, unless the administrator gave it its own date; an
audio in a project lives until the project expires.
"""
from datetime import datetime, timedelta, timezone
from typing import Optional

# The furthest the administrator may extend anything, from now.
MAX_EXTENSION_DAYS = 365


def job_expires_at(job: dict, retention_hours: int) -> Optional[datetime]:
    """When an audio outside a project is deleted (None for an audio in a project)."""
    if job.get("project_uuid"):
        return None
    return job.get("expires_at") or job["created_at"] + timedelta(hours=retention_hours)


def extension_error(
    current: datetime, new: datetime, now: Optional[datetime] = None
) -> Optional[str]:
    """Why `new` cannot replace the expiry `current`, or None if it can."""
    if new.tzinfo is None:
        return "The date must include its time zone"
    now = now or datetime.now(timezone.utc)
    if new <= current or new <= now:
        return "The new date must be later than the current expiry"
    if new > now + timedelta(days=MAX_EXTENSION_DAYS):
        return f"The new date can be at most {MAX_EXTENSION_DAYS} days from now"
    return None
