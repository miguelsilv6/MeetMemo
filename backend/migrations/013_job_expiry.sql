-- When an audio outside a project is deleted, once the administrator has
-- extended it. NULL follows the retention set in the admin panel (counted
-- from created_at). Audios in a project live until their project expires.
--
-- Idempotent: the application also executes this file at startup.

ALTER TABLE jobs ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;
