-- What estimates how long an audio still takes to process: its length, when
-- its current step started (and with which model), and how long each step
-- took on this server for each second of audio (the latest runs per step and
-- model are kept).
--
-- Idempotent: the application also executes this file at startup.

ALTER TABLE jobs ADD COLUMN IF NOT EXISTS audio_seconds DOUBLE PRECISION;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS step_started_at TIMESTAMPTZ;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS step_model TEXT;

CREATE TABLE IF NOT EXISTS step_timings (
    id BIGSERIAL PRIMARY KEY,
    step TEXT NOT NULL,
    model TEXT NOT NULL DEFAULT '',
    audio_seconds DOUBLE PRECISION NOT NULL CHECK (audio_seconds > 0),
    seconds DOUBLE PRECISION NOT NULL CHECK (seconds >= 0),
    finished_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_step_timings_step
    ON step_timings (step, model, finished_at DESC);
