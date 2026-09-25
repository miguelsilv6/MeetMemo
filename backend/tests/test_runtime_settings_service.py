"""Tests for RuntimeSettingsService: defaults, fallbacks and audited updates."""
import asyncio

import pytest
from runtime_settings import RuntimeSettings
from services.runtime_settings_service import RuntimeSettingsService


class StubSettings:
    whisper_model_name = "large-v3"
    job_retention_hours = 12


class FakeRepo:
    def __init__(self, stored=None, fail=False):
        self.stored = stored
        self.fail = fail
        self.saved = None

    async def get_runtime_settings(self):
        if self.fail:
            raise RuntimeError("relation runtime_settings does not exist")
        return self.stored

    async def save_runtime_settings(self, data, actor, changes):
        self.saved = (data, actor, changes)
        self.stored = data


def run(coro):
    return asyncio.run(coro)


def test_uses_defaults_when_storage_is_unreadable():
    service = RuntimeSettingsService(StubSettings(), FakeRepo(fail=True))
    assert run(service.get()) == service.defaults()


def test_saved_values_override_defaults():
    service = RuntimeSettingsService(StubSettings(), FakeRepo(stored={"beam_size": 2}))
    assert run(service.get()).beam_size == 2


def test_a_saved_model_that_is_no_longer_allowed_falls_back_to_the_default():
    repo = FakeRepo(stored={"whisper_model_name": "/old/custom/path"})
    assert run(RuntimeSettingsService(StubSettings(), repo).get()).whisper_model_name == "large-v3"


def test_update_rejects_models_outside_the_allowlist():
    service = RuntimeSettingsService(StubSettings(), FakeRepo())
    with pytest.raises(ValueError):
        run(service.update(RuntimeSettings(whisper_model_name="someone/evil"), "admin"))


def test_update_saves_and_audits_only_the_changed_fields():
    repo = FakeRepo()
    service = RuntimeSettingsService(StubSettings(), repo)
    new = service.defaults().model_copy(update={"whisper_model_name": "turbo", "beam_size": 3})

    changed = run(service.update(new, "admin"))

    assert changed == ["whisper_model_name", "beam_size"]
    data, actor, changes = repo.saved
    assert actor == "admin"
    assert data["whisper_model_name"] == "turbo"
    assert changes == [("whisper_model_name", "large-v3", "turbo"), ("beam_size", 5, 3)]


def test_update_without_changes_writes_nothing():
    repo = FakeRepo()
    service = RuntimeSettingsService(StubSettings(), repo)
    assert run(service.update(service.defaults(), "admin")) == []
    assert repo.saved is None
