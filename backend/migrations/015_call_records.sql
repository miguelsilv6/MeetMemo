-- Call records: the TranslatedPRI.xml that comes with an intercepted audio
-- (case, target, product, start and end, caller and callee, cells, events).
-- One per audio. The file is kept byte for byte with its SHA-256; the fields
-- read from it are in ``data`` (see services/call_record.py). Replacing it
-- keeps the replaced file's hash, name, importer and time in ``history``.
-- It goes when the audio is deleted.
--
-- Idempotent on purpose: the application also executes this file at startup.

CREATE TABLE IF NOT EXISTS call_records (
    job_uuid UUID PRIMARY KEY REFERENCES jobs (uuid) ON DELETE CASCADE,
    source_name TEXT NOT NULL,
    content BYTEA NOT NULL,
    sha256 TEXT NOT NULL,
    data JSONB NOT NULL,
    imported_by TEXT,
    imported_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    history JSONB NOT NULL DEFAULT '[]'::jsonb
);
