"""
Token repository: the administrator's grants and revocations, and the ledger
of every token movement (charges and refunds happen with the audios, in
database.charge_token and the refund trigger).
"""
from typing import Optional

from database import get_db


class NegativeBalanceError(Exception):
    """Taking this many tokens would leave the balance below zero."""


class TokenRepository:
    """Token balances and their ledger."""

    async def adjust(
        self, user_uuid: str, delta: int, actor: str, note: Optional[str]
    ) -> Optional[int]:
        """
        Add (``delta`` > 0) or take (``delta`` < 0) tokens, recorded in the ledger.

        Returns:
            The new balance, or None if the user does not exist.

        Raises:
            NegativeBalanceError: If the balance would drop below zero.
        """
        async with get_db() as conn:
            async with conn.transaction():
                current = await conn.fetchval(
                    "SELECT token_balance FROM users WHERE uuid = $1 FOR UPDATE", user_uuid
                )
                if current is None:
                    return None
                if current + delta < 0:
                    raise NegativeBalanceError(current)
                balance = await conn.fetchval(
                    """UPDATE users SET token_balance = token_balance + $2
                       WHERE uuid = $1 RETURNING token_balance""",
                    user_uuid, delta,
                )
                await conn.execute(
                    """INSERT INTO token_transactions
                           (user_uuid, delta, balance_after, reason, actor, note)
                       VALUES ($1, $2, $3, $4, $5, $6)""",
                    user_uuid, delta, balance, "grant" if delta > 0 else "revoke", actor, note,
                )
        return balance

    async def history(self, user_uuid: str, limit: int = 200) -> list[dict]:
        """The user's token movements, newest first, with the audio's name if it still exists."""
        async with get_db() as conn:
            rows = await conn.fetch(
                """SELECT t.id, t.created_at, t.delta, t.balance_after, t.reason, t.job_uuid,
                          j.file_name, t.actor, t.note, t.pool, t.quota_day
                   FROM token_transactions t
                   LEFT JOIN jobs j ON j.uuid = t.job_uuid
                   WHERE t.user_uuid = $1
                   ORDER BY t.created_at DESC, t.id DESC
                   LIMIT $2""",
                user_uuid, limit,
            )
        return [dict(row) for row in rows]
