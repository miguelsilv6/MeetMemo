-- Unlimited tokens: an account the administrator marks as unlimited is never
-- charged for a transcription (and so never refunded). Its extra balance and
-- daily quota are kept as they are, and apply again if the mark is removed.
--
-- Idempotent on purpose, like 006 and 007: the application also executes this
-- file at startup.

ALTER TABLE users ADD COLUMN IF NOT EXISTS unlimited_tokens BOOLEAN NOT NULL DEFAULT FALSE;
