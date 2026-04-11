CREATE TABLE IF NOT EXISTS inbox_groups (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  group_type TEXT DEFAULT 'shared' CHECK (group_type IN ('shared', 'personal')),
  branch TEXT,
  department TEXT,
  bounce_threshold_minutes INTEGER DEFAULT 15,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS inbox_channels (
  id SERIAL PRIMARY KEY,
  inbox_group_id INTEGER NOT NULL REFERENCES inbox_groups(id) ON DELETE CASCADE,
  channel_type TEXT NOT NULL DEFAULT 'email' CHECK (channel_type IN ('email', 'whatsapp', 'live_chat', 'sms')),
  channel_address TEXT NOT NULL,
  display_name TEXT,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(channel_type, channel_address)
);

CREATE TABLE IF NOT EXISTS inbox_group_access (
  id SERIAL PRIMARY KEY,
  inbox_group_id INTEGER NOT NULL REFERENCES inbox_groups(id) ON DELETE CASCADE,
  user_email TEXT NOT NULL,
  role TEXT DEFAULT 'member' CHECK (role IN ('admin', 'member')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(inbox_group_id, user_email)
);

CREATE INDEX IF NOT EXISTS idx_inbox_channels_group ON inbox_channels(inbox_group_id);
CREATE INDEX IF NOT EXISTS idx_inbox_access_user ON inbox_group_access(user_email);

ALTER TABLE inbox_groups ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all" ON inbox_groups FOR ALL USING (true);
GRANT ALL ON inbox_groups TO anon, authenticated;
GRANT USAGE, SELECT ON SEQUENCE inbox_groups_id_seq TO anon, authenticated;

ALTER TABLE inbox_channels ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all" ON inbox_channels FOR ALL USING (true);
GRANT ALL ON inbox_channels TO anon, authenticated;
GRANT USAGE, SELECT ON SEQUENCE inbox_channels_id_seq TO anon, authenticated;

ALTER TABLE inbox_group_access ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all" ON inbox_group_access FOR ALL USING (true);
GRANT ALL ON inbox_group_access TO anon, authenticated;
GRANT USAGE, SELECT ON SEQUENCE inbox_group_access_id_seq TO anon, authenticated;

-- Seed data for inbox groups and channels is deployment-specific and
-- lives outside the versioned schema migrations. Populate via a separate
-- seed script or the application's admin UI per tenant.
