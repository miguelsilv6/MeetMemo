-- Daily tokens: besides the balance the administrator grants (the "extra"
-- balance), each user can have a daily quota that is back to full every day
-- and does not accumulate. Uploads spend the day's quota first, then the
-- extra balance. The quota is each user's own value, or the default set in
-- the admin panel (runtime setting default_daily_tokens) when they have none.
--
-- The day's count is reset lazily: daily_tokens_used only counts while
-- daily_tokens_day is today (tokens_today(), in the configured time zone).
--
-- Idempotent on purpose, like 006_tokens.sql: the application also executes
-- this file at startup (always after 006, whose refund function it replaces).

ALTER TABLE users ADD COLUMN IF NOT EXISTS daily_token_quota INTEGER;
ALTER TABLE users ADD COLUMN IF NOT EXISTS daily_tokens_used INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS daily_tokens_day DATE;

DO $$
BEGIN
    ALTER TABLE users
        ADD CONSTRAINT users_daily_token_quota_range
        CHECK (daily_token_quota IS NULL OR daily_token_quota BETWEEN 0 AND 10000);
EXCEPTION WHEN duplicate_object THEN
    NULL;
END $$;

DO $$
BEGIN
    ALTER TABLE users
        ADD CONSTRAINT users_daily_tokens_used_not_negative CHECK (daily_tokens_used >= 0);
EXCEPTION WHEN duplicate_object THEN
    NULL;
END $$;

-- Where each movement's token came from. balance_after is always the extra
-- balance, so the deltas of the 'balance' rows still add up to it; 'daily'
-- rows record which day's quota they belong to.
ALTER TABLE token_transactions
    ADD COLUMN IF NOT EXISTS pool VARCHAR(8) NOT NULL DEFAULT 'balance';
ALTER TABLE token_transactions ADD COLUMN IF NOT EXISTS quota_day DATE;

DO $$
BEGIN
    ALTER TABLE token_transactions
        ADD CONSTRAINT token_transactions_pool_valid CHECK (pool IN ('balance', 'daily'));
EXCEPTION WHEN duplicate_object THEN
    NULL;
END $$;

-- Today's date for the daily quota. Replaced at startup with the configured
-- time zone (TOKENS_TIMEZONE); this is the default.
CREATE OR REPLACE FUNCTION tokens_today()
RETURNS DATE AS $$
    SELECT (NOW() AT TIME ZONE 'Europe/Lisbon')::date
$$ LANGUAGE sql STABLE;

-- The admin panel's default daily quota (0 when never set).
CREATE OR REPLACE FUNCTION default_daily_tokens()
RETURNS INTEGER AS $$
BEGIN
    RETURN COALESCE(
        (SELECT (data->>'default_daily_tokens')::int FROM runtime_settings WHERE id = 1),
        0
    );
EXCEPTION WHEN undefined_table THEN
    RETURN 0;
END;
$$ LANGUAGE plpgsql STABLE;

-- Give back the latest charge of a job that has not been refunded yet, to the
-- pool it came from. A daily token only comes back while its day's quota is
-- still the current one (after midnight the quota is full again anyway).
-- Returns whether a token was refunded.
CREATE OR REPLACE FUNCTION refund_job_charge(p_job UUID, p_actor TEXT, p_note TEXT)
RETURNS BOOLEAN AS $$
DECLARE
    charge RECORD;
    new_balance INTEGER;
BEGIN
    SELECT t.id, t.user_uuid, t.pool, t.quota_day INTO charge
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

    IF charge.pool = 'daily' THEN
        UPDATE users SET daily_tokens_used = daily_tokens_used - 1
        WHERE uuid = charge.user_uuid
          AND daily_tokens_day = charge.quota_day
          AND daily_tokens_used > 0
        RETURNING token_balance INTO new_balance;
    ELSE
        UPDATE users SET token_balance = token_balance + 1
        WHERE uuid = charge.user_uuid
        RETURNING token_balance INTO new_balance;
    END IF;
    IF NOT FOUND THEN
        RETURN FALSE;
    END IF;

    INSERT INTO token_transactions
        (user_uuid, delta, balance_after, reason, job_uuid, refund_of, actor, note,
         pool, quota_day)
    VALUES (charge.user_uuid, 1, new_balance, 'refund', p_job, charge.id, p_actor, p_note,
            charge.pool, charge.quota_day);
    RETURN TRUE;
EXCEPTION WHEN unique_violation THEN
    -- Refunded concurrently; the change above is rolled back.
    RETURN FALSE;
END;
$$ LANGUAGE plpgsql;
