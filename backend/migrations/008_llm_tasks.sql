-- Summaries and translations run as background tasks on the server, one at a
-- time, so no request waits on the language model (proxies in front of the
-- app cut requests after ~100 s). The page starts a task and polls it.
--
-- Idempotent on purpose: the application also executes this file at startup.

CREATE TABLE IF NOT EXISTS llm_tasks (
    id BIGSERIAL PRIMARY KEY,
    job_uuid UUID NOT NULL REFERENCES jobs (uuid) ON DELETE CASCADE,
    kind VARCHAR(12) NOT NULL CHECK (kind IN ('summary', 'translation')),
    status VARCHAR(8) NOT NULL DEFAULT 'queued'
        CHECK (status IN ('queued', 'running', 'done', 'error')),
    progress_done INTEGER NOT NULL DEFAULT 0,
    progress_total INTEGER NOT NULL DEFAULT 0,
    -- The summary's custom prompts, if any.
    params JSONB NOT NULL DEFAULT '{}'::jsonb,
    -- On failure: a short code the page translates, and the technical detail.
    error_code VARCHAR(24),
    error TEXT,
    requested_by TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    started_at TIMESTAMPTZ,
    finished_at TIMESTAMPTZ
);

-- At most one waiting or running task per audio and kind: asking again while
-- one is under way returns it.
CREATE UNIQUE INDEX IF NOT EXISTS idx_llm_tasks_active
    ON llm_tasks (job_uuid, kind) WHERE status IN ('queued', 'running');
CREATE INDEX IF NOT EXISTS idx_llm_tasks_job ON llm_tasks (job_uuid, kind, id DESC);
CREATE INDEX IF NOT EXISTS idx_llm_tasks_queued ON llm_tasks (id) WHERE status = 'queued';
