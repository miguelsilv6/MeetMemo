"""
Admin repository: admin credentials, sessions, runtime settings and their
audit trail.
"""
import json
from datetime import datetime
from typing import Any, Optional

from database import get_db


def _load_json(value: Any) -> Any:
    return json.loads(value) if isinstance(value, str) else value


class AdminRepository:
    """Data access for the admin panel."""

    # ------------------------------------------------------------------
    # Credentials
    # ------------------------------------------------------------------

    async def get_credentials(self) -> Optional[dict]:
        """The single admin account (username + password hash), if configured."""
        async with get_db() as conn:
            row = await conn.fetchrow(
                "SELECT username, password_hash FROM admin_credentials WHERE id = 1"
            )
        return dict(row) if row else None

    async def create_credentials_if_missing(self, username: str, password_hash: str) -> bool:
        """Bootstrap the admin account. Returns False if one already exists."""
        async with get_db() as conn:
            result = await conn.execute(
                """INSERT INTO admin_credentials (id, username, password_hash)
                   VALUES (1, $1, $2)
                   ON CONFLICT (id) DO NOTHING""",
                username,
                password_hash,
            )
        return result.endswith(" 1")

    async def update_password(
        self, username: str, password_hash: str, keep_session_hash: str
    ) -> None:
        """Change the password, revoke every other session, and audit it."""
        async with get_db() as conn:
            async with conn.transaction():
                await conn.execute(
                    """UPDATE admin_credentials
                       SET password_hash = $1, updated_at = NOW() WHERE id = 1""",
                    password_hash,
                )
                await conn.execute(
                    "DELETE FROM admin_sessions WHERE token_hash <> $1",
                    keep_session_hash,
                )
                await conn.execute(
                    """INSERT INTO settings_audit (actor, setting_key, old_value, new_value)
                       VALUES ($1, 'admin_password', NULL, NULL)""",
                    username,
                )

    # ------------------------------------------------------------------
    # Sessions
    # ------------------------------------------------------------------

    async def create_session(self, token_hash: str, username: str, expires_at: datetime) -> None:
        """Store a new session (by token hash) and drop expired ones."""
        async with get_db() as conn:
            await conn.execute("DELETE FROM admin_sessions WHERE expires_at <= NOW()")
            await conn.execute(
                """INSERT INTO admin_sessions (token_hash, username, expires_at)
                   VALUES ($1, $2, $3)""",
                token_hash,
                username,
                expires_at,
            )

    async def get_session(self, token_hash: str) -> Optional[dict]:
        """The live (unexpired) session for this token hash, if any."""
        async with get_db() as conn:
            row = await conn.fetchrow(
                """SELECT username, expires_at FROM admin_sessions
                   WHERE token_hash = $1 AND expires_at > NOW()""",
                token_hash,
            )
        return dict(row) if row else None

    async def delete_session(self, token_hash: str) -> None:
        """Log a session out."""
        async with get_db() as conn:
            await conn.execute("DELETE FROM admin_sessions WHERE token_hash = $1", token_hash)

    async def purge_expired_sessions(self) -> None:
        """Remove expired sessions."""
        async with get_db() as conn:
            await conn.execute("DELETE FROM admin_sessions WHERE expires_at <= NOW()")

    # ------------------------------------------------------------------
    # Runtime settings and audit
    # ------------------------------------------------------------------

    async def get_runtime_settings(self) -> Optional[dict]:
        """Saved runtime settings, or None if nothing was saved yet."""
        async with get_db() as conn:
            row = await conn.fetchrow("SELECT data FROM runtime_settings WHERE id = 1")
        return _load_json(row["data"]) if row else None

    async def save_runtime_settings(
        self, data: dict, actor: str, changes: list[tuple[str, Any, Any]]
    ) -> None:
        """Save the settings and one audit row per changed field, atomically."""
        async with get_db() as conn:
            async with conn.transaction():
                await conn.execute(
                    """INSERT INTO runtime_settings (id, data, updated_at)
                       VALUES (1, $1::jsonb, NOW())
                       ON CONFLICT (id) DO UPDATE
                       SET data = EXCLUDED.data, updated_at = NOW()""",
                    json.dumps(data),
                )
                await conn.executemany(
                    """INSERT INTO settings_audit (actor, setting_key, old_value, new_value)
                       VALUES ($1, $2, $3::jsonb, $4::jsonb)""",
                    [
                        (actor, key, json.dumps(old), json.dumps(new))
                        for key, old, new in changes
                    ],
                )

    async def list_audit(self, limit: int = 100) -> list[dict]:
        """Most recent audit entries first."""
        async with get_db() as conn:
            rows = await conn.fetch(
                """SELECT id, changed_at, actor, setting_key, old_value, new_value
                   FROM settings_audit ORDER BY changed_at DESC, id DESC LIMIT $1""",
                limit,
            )
        return [
            {
                "id": row["id"],
                "changed_at": row["changed_at"].isoformat(),
                "actor": row["actor"],
                "setting_key": row["setting_key"],
                "old_value": _load_json(row["old_value"]),
                "new_value": _load_json(row["new_value"]),
            }
            for row in rows
        ]
