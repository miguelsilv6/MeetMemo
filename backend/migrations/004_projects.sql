-- Projects: several audios grouped under one case, processed by a server-side
-- queue and deleted in full (audio, transcripts, summaries, translations and
-- exports) when the project expires.
--
-- Idempotent on purpose: docker-entrypoint-initdb.d only runs on a brand-new
-- database, so the application also executes this file at startup to bring
-- existing installations up to date.

CREATE TABLE IF NOT EXISTS projects (
    uuid UUID PRIMARY KEY,
    name VARCHAR(200) NOT NULL,
    reference VARCHAR(100),
    description TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    -- Fixed when the project is created, from the retention in effect then.
    expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_projects_expires_at ON projects (expires_at);

-- NULL for audios uploaded on their own, outside any project. The cascade is
-- a safety net: the application deletes a project's files before its rows.
ALTER TABLE jobs
    ADD COLUMN IF NOT EXISTS project_uuid UUID REFERENCES projects (uuid) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_jobs_project_uuid ON jobs (project_uuid)
    WHERE project_uuid IS NOT NULL;
