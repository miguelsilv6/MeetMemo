"""When audios and projects are deleted, and how far the administrator may extend that."""
from datetime import datetime, timedelta, timezone

from services.expiry import MAX_EXTENSION_DAYS, extension_error, job_expires_at

NOW = datetime(2026, 10, 27, 12, 0, tzinfo=timezone.utc)


def test_an_audio_outside_a_project_follows_the_retention_until_extended():
    job = {"created_at": NOW, "project_uuid": None, "expires_at": None}
    assert job_expires_at(job, 12) == NOW + timedelta(hours=12)
    extended = {**job, "expires_at": NOW + timedelta(days=5)}
    assert job_expires_at(extended, 12) == NOW + timedelta(days=5)


def test_an_audio_in_a_project_lives_as_long_as_the_project():
    job = {"created_at": NOW, "project_uuid": "p1", "expires_at": None}
    assert job_expires_at(job, 12) is None


def test_an_extension_must_be_later_and_within_a_year():
    current = NOW + timedelta(hours=3)
    assert extension_error(current, NOW + timedelta(days=7), NOW) is None
    assert extension_error(current, NOW + timedelta(days=MAX_EXTENSION_DAYS), NOW) is None
    assert "later" in extension_error(current, NOW + timedelta(hours=2), NOW)
    assert "later" in extension_error(current, current, NOW)
    assert "365" in extension_error(current, NOW + timedelta(days=366), NOW)
    assert "time zone" in extension_error(current, datetime(2026, 11, 1), NOW)


def test_an_expired_audio_not_yet_deleted_can_be_kept():
    expired = NOW - timedelta(hours=1)
    assert extension_error(expired, NOW + timedelta(days=1), NOW) is None
    assert "later" in extension_error(expired, NOW - timedelta(minutes=1), NOW)
