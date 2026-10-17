-- How many people speak in an audio, when the uploader knows it (2-6).
-- Passed to speaker diarization, so a two-person call is not split into a
-- third, phantom speaker. NULL lets diarization decide.
--
-- Idempotent: the application also executes this file at startup.

ALTER TABLE jobs ADD COLUMN IF NOT EXISTS num_speakers SMALLINT
    CHECK (num_speakers IS NULL OR num_speakers BETWEEN 2 AND 6);
