"""
User repository: accounts, their sessions, and what each one owns.
"""
from datetime import datetime
from typing import Optional

import asyncpg
from database import get_db

_USER_COLUMNS = """u.uuid, u.username, u.display_name, u.is_active, u.must_change_password,
                   u.created_at, u.last_login_at"""


class UsernameTakenError(Exception):
    """Another account already uses this username (case-insensitively)."""


class UserRepository:
    """Data access for user accounts and sessions."""

    # ------------------------------------------------------------------
    # Accounts
    # ------------------------------------------------------------------

    async def create(
        self, uuid: str, username: str, display_name: str, password_hash: str
    ) -> dict:
        """
        Create an account that must choose a new password on first login.

        Raises:
            UsernameTakenError: If the username is already used.
        """
        try:
            async with get_db() as conn:
                row = await conn.fetchrow(
                    f"""INSERT INTO users AS u (uuid, username, display_name, password_hash)
                        VALUES ($1, $2, $3, $4)
                        RETURNING {_USER_COLUMNS}""",
                    uuid, username, display_name, password_hash,
                )
        except asyncpg.UniqueViolationError as e:
            raise UsernameTakenError(username) from e
        return dict(row)

    async def get(self, uuid: str) -> Optional[dict]:
        """One account (without its password hash), or None."""
        async with get_db() as conn:
            row = await conn.fetchrow(
                f"SELECT {_USER_COLUMNS} FROM users u WHERE u.uuid = $1", uuid
            )
        return dict(row) if row else None

    async def get_credentials(self, username: str) -> Optional[dict]:
        """uuid, password hash and state of the account with this username."""
        async with get_db() as conn:
            row = await conn.fetchrow(
                """SELECT uuid, username, password_hash, is_active
                   FROM users WHERE LOWER(username) = LOWER($1)""",
                username,
            )
        return dict(row) if row else None

    async def get_password_hash(self, uuid: str) -> Optional[str]:
        """The account's password hash."""
        async with get_db() as conn:
            return await conn.fetchval("SELECT password_hash FROM users WHERE uuid = $1", uuid)

    async def list_with_counts(self) -> list[dict]:
        """Every account, by username, with how many projects and audios it owns."""
        async with get_db() as conn:
            rows = await conn.fetch(
                f"""SELECT {_USER_COLUMNS},
                          (SELECT COUNT(*) FROM projects p WHERE p.user_uuid = u.uuid)
                              AS project_count,
                          (SELECT COUNT(*) FROM jobs j WHERE j.user_uuid = u.uuid)
                              AS audio_count
                   FROM users u
                   ORDER BY LOWER(u.username)"""
            )
        return [dict(row) for row in rows]

    async def update(
        self, uuid: str, display_name: Optional[str], is_active: Optional[bool]
    ) -> Optional[dict]:
        """Change the display name and/or active state; None leaves a field as is."""
        async with get_db() as conn:
            row = await conn.fetchrow(
                f"""UPDATE users AS u
                    SET display_name = COALESCE($2, display_name),
                        is_active = COALESCE($3, is_active)
                    WHERE uuid = $1
                    RETURNING {_USER_COLUMNS}""",
                uuid, display_name, is_active,
            )
            if row and is_active is False:
                await conn.execute("DELETE FROM user_sessions WHERE user_uuid = $1", uuid)
        return dict(row) if row else None

    async def set_password(
        self,
        uuid: str,
        password_hash: str,
        must_change: bool,
        keep_session_hash: Optional[str] = None,
    ) -> None:
        """Replace the password and sign out every session but `keep_session_hash`."""
        async with get_db() as conn:
            async with conn.transaction():
                await conn.execute(
                    """UPDATE users SET password_hash = $2, must_change_password = $3
                       WHERE uuid = $1""",
                    uuid, password_hash, must_change,
                )
                await conn.execute(
                    """DELETE FROM user_sessions
                       WHERE user_uuid = $1 AND token_hash IS DISTINCT FROM $2""",
                    uuid, keep_session_hash,
                )

    async def delete(self, uuid: str) -> bool:
        """Delete the account (its audios and projects must be deleted first)."""
        async with get_db() as conn:
            result = await conn.execute("DELETE FROM users WHERE uuid = $1", uuid)
        return result.endswith(" 1")

    # ------------------------------------------------------------------
    # Sessions
    # ------------------------------------------------------------------

    async def create_session(self, token_hash: str, user_uuid: str, expires_at: datetime) -> None:
        """Store a new session (by token hash) and record the login."""
        async with get_db() as conn:
            async with conn.transaction():
                await conn.execute(
                    """INSERT INTO user_sessions (token_hash, user_uuid, expires_at)
                       VALUES ($1, $2, $3)""",
                    token_hash, user_uuid, expires_at,
                )
                await conn.execute(
                    "UPDATE users SET last_login_at = NOW() WHERE uuid = $1", user_uuid
                )

    async def get_session_user(self, token_hash: str) -> Optional[dict]:
        """The active account behind a live session, or None."""
        async with get_db() as conn:
            row = await conn.fetchrow(
                f"""SELECT {_USER_COLUMNS}
                    FROM user_sessions s JOIN users u ON u.uuid = s.user_uuid
                    WHERE s.token_hash = $1 AND s.expires_at > NOW() AND u.is_active""",
                token_hash,
            )
        return dict(row) if row else None

    async def delete_session(self, token_hash: str) -> None:
        """Log a session out."""
        async with get_db() as conn:
            await conn.execute("DELETE FROM user_sessions WHERE token_hash = $1", token_hash)

    async def purge_expired_sessions(self) -> None:
        """Remove expired sessions."""
        async with get_db() as conn:
            await conn.execute("DELETE FROM user_sessions WHERE expires_at <= NOW()")

    # ------------------------------------------------------------------
    # What an account owns
    # ------------------------------------------------------------------

    async def owned_files(self, uuid: str) -> list[dict]:
        """Every audio of the account (in projects or not) with its export files."""
        async with get_db() as conn:
            rows = await conn.fetch(
                """SELECT j.uuid, j.file_name,
                          COALESCE(
                              ARRAY_AGG(e.file_path) FILTER (WHERE e.file_path IS NOT NULL),
                              '{}'
                          ) AS export_paths
                   FROM jobs j
                   LEFT JOIN export_jobs e ON e.job_uuid = j.uuid
                   WHERE j.user_uuid = $1
                   GROUP BY j.uuid, j.file_name""",
                uuid,
            )
        return [dict(row) for row in rows]

    async def delete_owned(self, uuid: str) -> None:
        """Delete the rows of every audio and project of the account."""
        async with get_db() as conn:
            async with conn.transaction():
                await conn.execute("DELETE FROM jobs WHERE user_uuid = $1", uuid)
                await conn.execute("DELETE FROM projects WHERE user_uuid = $1", uuid)

    async def content(self, uuid: str) -> dict:
        """The account's projects and its audios outside projects, newest first."""
        async with get_db() as conn:
            projects = await conn.fetch(
                """SELECT p.uuid, p.name, p.reference, p.created_at, p.expires_at,
                          COUNT(j.uuid) AS audio_count
                   FROM projects p LEFT JOIN jobs j ON j.project_uuid = p.uuid
                   WHERE p.user_uuid = $1
                   GROUP BY p.uuid
                   ORDER BY p.created_at DESC""",
                uuid,
            )
            audios = await conn.fetch(
                """SELECT uuid, file_name, workflow_state, created_at
                   FROM jobs
                   WHERE user_uuid = $1 AND project_uuid IS NULL
                   ORDER BY created_at DESC""",
                uuid,
            )
        return {
            "projects": [dict(row) for row in projects],
            "audios": [dict(row) for row in audios],
        }
