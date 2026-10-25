-- Cue points: instants of an audio a reviewer marked as worth coming back to,
-- each with an optional note. They belong to the audio, not to a transcript,
-- so they survive a re-transcription and go when the audio is deleted.
--
-- Idempotent on purpose: the application also executes this file at startup.

CREATE TABLE IF NOT EXISTS cue_points (
    id BIGSERIAL PRIMARY KEY,
    job_uuid UUID NOT NULL REFERENCES jobs (uuid) ON DELETE CASCADE,
    position_seconds DOUBLE PRECISION NOT NULL CHECK (position_seconds >= 0),
    note TEXT NOT NULL DEFAULT '' CHECK (char_length(note) <= 500),
    created_by TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cue_points_job ON cue_points (job_uuid, position_seconds);
