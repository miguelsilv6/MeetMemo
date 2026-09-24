-- Admin panel: a single admin account, server-side sessions, runtime-tunable
-- transcription settings, and an audit trail of every settings change.
--
-- Idempotent on purpose: docker-entrypoint-initdb.d only runs on a brand-new
-- database, so the application also executes this file at startup to bring
-- existing installations up to date.

CREATE TABLE IF NOT EXISTS admin_credentials (
    id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    username TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Only a SHA-256 of each session token is stored, never the token itself.
CREATE TABLE IF NOT EXISTS admin_sessions (
    token_hash TEXT PRIMARY KEY,
    username TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_admin_sessions_expires_at ON admin_sessions (expires_at);

CREATE TABLE IF NOT EXISTS runtime_settings (
    id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    data JSONB NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS settings_audit (
    id BIGSERIAL PRIMARY KEY,
    changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    actor TEXT NOT NULL,
    setting_key TEXT NOT NULL,
    old_value JSONB,
    new_value JSONB
);

CREATE INDEX IF NOT EXISTS idx_settings_audit_changed_at ON settings_audit (changed_at DESC);
