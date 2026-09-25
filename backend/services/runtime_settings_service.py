"""
Effective runtime settings: environment/profile defaults overlaid with the
values saved from the admin panel.

Read once per job rather than cached, so a change applies to the next job
immediately and there is no cache to go stale.
"""
import logging
from typing import Optional

from config import Settings
from repositories.admin_repository import AdminRepository
from runtime_settings import (
    RuntimeSettings,
    allowed_whisper_models,
    default_runtime_settings,
    diff_settings,
    merge_stored,
)

logger = logging.getLogger(__name__)


class RuntimeSettingsService:
    """Read and update the settings the admin panel controls."""

    def __init__(self, settings: Settings, repo: Optional[AdminRepository] = None):
        self.settings = settings
        self.repo = repo or AdminRepository()

    def defaults(self) -> RuntimeSettings:
        """Values in effect before anything is saved from the panel."""
        return default_runtime_settings(
            self.settings.whisper_model_name, self.settings.job_retention_hours
        )

    def allowed_models(self) -> list[str]:
        """Whisper models the panel may select."""
        return allowed_whisper_models(self.settings.whisper_model_name)

    async def get(self) -> RuntimeSettings:
        """The settings currently in effect."""
        defaults = self.defaults()
        try:
            stored = await self.repo.get_runtime_settings()
        except Exception as e:  # pylint: disable=broad-exception-caught
            # Transcription must not depend on the admin panel's storage.
            logger.error("Could not read runtime settings, using defaults: %s", e)
            stored = None
        effective = merge_stored(defaults, stored)
        if effective.whisper_model_name not in self.allowed_models():
            logger.error(
                "Saved Whisper model %r is no longer allowed; using %r",
                effective.whisper_model_name,
                defaults.whisper_model_name,
            )
            effective = effective.model_copy(
                update={"whisper_model_name": defaults.whisper_model_name}
            )
        return effective

    async def update(self, new: RuntimeSettings, actor: str) -> list[str]:
        """
        Save new settings and audit each changed field.

        Returns:
            The names of the fields that changed.

        Raises:
            ValueError: If the Whisper model is not in the allowlist.
        """
        if new.whisper_model_name not in self.allowed_models():
            raise ValueError("Unsupported Whisper model")
        changes = diff_settings(await self.get(), new)
        if changes:
            await self.repo.save_runtime_settings(new.model_dump(), actor, changes)
            logger.info(
                "Runtime settings changed by %s: %s", actor, ", ".join(k for k, _, _ in changes)
            )
        return [key for key, _, _ in changes]
