-- Remember refined reply patterns so similar future emails get the learned
-- replies as additional suggestions. Matching is keyed primarily on sender
-- domain (most stable signal - appsumo.com sends similar emails every time)
-- with category as a secondary bucket.

CREATE TABLE IF NOT EXISTS reply_learnings (
  id SERIAL PRIMARY KEY,
  user_email TEXT NOT NULL,
  sender_domain TEXT,
  sender_email TEXT,
  category TEXT,
  instruction TEXT NOT NULL,
  reply_options JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_used_at TIMESTAMPTZ,
  usage_count INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS reply_learnings_domain_idx
  ON reply_learnings (sender_domain, user_email);
CREATE INDEX IF NOT EXISTS reply_learnings_category_idx
  ON reply_learnings (category, user_email);
CREATE INDEX IF NOT EXISTS reply_learnings_sender_idx
  ON reply_learnings (sender_email, user_email);
