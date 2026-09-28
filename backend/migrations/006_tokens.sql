-- Tokens: each transcription costs one. A user's balance is charged when an
-- audio is accepted (in the same transaction that creates the job), refunded
-- automatically if its processing fails, and topped up or reduced by the
-- administrator. Every movement is kept in a ledger, whose deltas always add
-- up to the balance.
--
-- Idempotent on purpose: docker-entrypoint-initdb.d only runs on a brand-new
-- database, so the application also executes this file at startup to bring
-- existing installations up to date.

ALTER TABLE users ADD COLUMN IF NOT EXISTS token_balance INTEGER NOT NULL DEFAULT 0;

DO $$
BEGIN
    ALTER TABLE users
        ADD CONSTRAINT users_token_balance_not_negative CHECK (token_balance >= 0);
EXCEPTION WHEN duplicate_object THEN
    NULL;
END $$;

CREATE TABLE IF NOT EXISTS token_transactions (
    id BIGSERIAL PRIMARY KEY,
    user_uuid UUID NOT NULL REFERENCES users (uuid) ON DELETE CASCADE,
    delta INTEGER NOT NULL CHECK (delta <> 0),
    balance_after INTEGER NOT NULL CHECK (balance_after >= 0),
    reason VARCHAR(10) NOT NULL CHECK (reason IN ('grant', 'revoke', 'charge', 'refund')),
    -- No foreign key: the history outlives the audio it was for.
    job_uuid UUID,
    -- The charge a refund gives back; unique, so no charge is refunded twice.
    refund_of BIGINT UNIQUE REFERENCES token_transactions (id) ON DELETE CASCADE,
    actor TEXT,
    note TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_token_transactions_user
    ON token_transactions (user_uuid, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_token_transactions_job
    ON token_transactions (job_uuid) WHERE job_uuid IS NOT NULL;

-- Give back the latest charge of a job that has not been refunded yet.
-- Returns whether a token was refunded.
CREATE OR REPLACE FUNCTION refund_job_charge(p_job UUID, p_actor TEXT, p_note TEXT)
RETURNS BOOLEAN AS $$
DECLARE
    charge RECORD;
    new_balance INTEGER;
BEGIN
    SELECT t.id, t.user_uuid INTO charge
    FROM token_transactions t
    WHERE t.job_uuid = p_job
      AND t.reason = 'charge'
      AND NOT EXISTS (SELECT 1 FROM token_transactions r WHERE r.refund_of = t.id)
    ORDER BY t.id DESC
    LIMIT 1
    FOR UPDATE;
    IF NOT FOUND THEN
        RETURN FALSE;
    END IF;

    UPDATE users SET token_balance = token_balance + 1
    WHERE uuid = charge.user_uuid
    RETURNING token_balance INTO new_balance;
    IF NOT FOUND THEN
        RETURN FALSE;
    END IF;

    INSERT INTO token_transactions
        (user_uuid, delta, balance_after, reason, job_uuid, refund_of, actor, note)
    VALUES (charge.user_uuid, 1, new_balance, 'refund', p_job, charge.id, p_actor, p_note);
    RETURN TRUE;
EXCEPTION WHEN unique_violation THEN
    -- Refunded concurrently; the balance change above is rolled back.
    RETURN FALSE;
END;
$$ LANGUAGE plpgsql;

-- Whatever marks an audio as failed (a step, the project queue), its token
-- comes back.
CREATE OR REPLACE FUNCTION refund_failed_job()
RETURNS TRIGGER AS $$
BEGIN
    PERFORM refund_job_charge(NEW.uuid, 'system', 'Processing failed');
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS refund_on_job_error ON jobs;
CREATE TRIGGER refund_on_job_error
    AFTER UPDATE OF workflow_state ON jobs
    FOR EACH ROW
    WHEN (NEW.workflow_state = 'error' AND OLD.workflow_state IS DISTINCT FROM 'error')
    EXECUTE FUNCTION refund_failed_job();
