-- Re-transcription: an audio already transcribed can be transcribed again
-- (e.g. with another language) without a new token. Its token was spent on
-- the first transcription, so from then on nothing gives it back: neither a
-- failure of the new transcription nor deleting the audio while it waits.
-- A project audio retried after a failure pays a new token, which is
-- refundable again.
--
-- Idempotent on purpose, like the other token migrations: the application
-- also executes this file at startup (after 006, whose trigger function it
-- replaces).

ALTER TABLE jobs ADD COLUMN IF NOT EXISTS token_refundable BOOLEAN NOT NULL DEFAULT TRUE;

CREATE OR REPLACE FUNCTION refund_failed_job()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.token_refundable THEN
        PERFORM refund_job_charge(NEW.uuid, 'system', 'Processing failed');
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
