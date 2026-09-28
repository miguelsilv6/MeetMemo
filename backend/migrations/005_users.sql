-- User accounts: every audio (job) and project belongs to one user, who alone
-- sees it (the administrator sees everything). Accounts are created by the
-- administrator; there is no public sign-up.
--
-- Idempotent on purpose: docker-entrypoint-initdb.d only runs on a brand-new
-- database, so the application also executes this file at startup to bring
-- existing installations up to date. Rows from before users existed have no
-- owner; the application deletes them (with their files) and then makes the
-- owner columns mandatory.

CREATE TABLE IF NOT EXISTS users (
    uuid UUID PRIMARY KEY,
    username VARCHAR(100) NOT NULL,
    display_name VARCHAR(200) NOT NULL,
    password_hash TEXT NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    -- Set when the administrator chooses the password: the user must pick a
    -- new one before using the application.
    must_change_password BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_login_at TIMESTAMPTZ
);

-- Usernames are unique regardless of case.
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username_lower ON users (LOWER(username));

-- Only a SHA-256 of each session token is stored, never the token itself.
CREATE TABLE IF NOT EXISTS user_sessions (
    token_hash TEXT PRIMARY KEY,
    user_uuid UUID NOT NULL REFERENCES users (uuid) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_user_sessions_expires_at ON user_sessions (expires_at);
CREATE INDEX IF NOT EXISTS idx_user_sessions_user_uuid ON user_sessions (user_uuid);

-- RESTRICT: a user is deleted through the application, which removes every
-- file of their audios first.
ALTER TABLE jobs
    ADD COLUMN IF NOT EXISTS user_uuid UUID REFERENCES users (uuid) ON DELETE RESTRICT;
ALTER TABLE projects
    ADD COLUMN IF NOT EXISTS user_uuid UUID REFERENCES users (uuid) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS idx_jobs_user_uuid ON jobs (user_uuid);
CREATE INDEX IF NOT EXISTS idx_projects_user_uuid ON projects (user_uuid);
