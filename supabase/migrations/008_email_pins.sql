-- Persist per-user email pins. Previously pins lived only in local React
-- state, so they vanished on refresh and the Pinned tab was always empty
-- after navigating away.

CREATE TABLE IF NOT EXISTS email_pins (
  id SERIAL PRIMARY KEY,
  user_email TEXT NOT NULL,
  email_id TEXT NOT NULL,
  pinned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_email, email_id)
);

CREATE INDEX IF NOT EXISTS email_pins_user_idx ON email_pins (user_email);
