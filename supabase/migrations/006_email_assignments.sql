CREATE TABLE IF NOT EXISTS email_assignments (
  id SERIAL PRIMARY KEY,
  email_id TEXT NOT NULL,
  inbox_group_id INTEGER REFERENCES inbox_groups(id),
  channel_address TEXT,
  assigned_to TEXT,
  status TEXT DEFAULT 'unassigned' CHECK (status IN ('unassigned', 'assigned', 'snoozed', 'done')),
  snoozed_until TIMESTAMPTZ,
  assigned_by TEXT,
  assigned_at TIMESTAMPTZ,
  done_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(email_id, inbox_group_id)
);

CREATE TABLE IF NOT EXISTS inbox_assignment_rules (
  id SERIAL PRIMARY KEY,
  inbox_group_id INTEGER NOT NULL REFERENCES inbox_groups(id) ON DELETE CASCADE,
  rule_type TEXT NOT NULL CHECK (rule_type IN ('account_code', 'sender_domain', 'job_ref', 'keyword')),
  rule_value TEXT NOT NULL,
  assign_to_email TEXT NOT NULL,
  priority INTEGER DEFAULT 10,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS email_assignment_log (
  id SERIAL PRIMARY KEY,
  email_id TEXT NOT NULL,
  action TEXT NOT NULL,
  from_user TEXT,
  to_user TEXT,
  performed_by TEXT NOT NULL,
  note TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_assignments_status ON email_assignments(status);
CREATE INDEX IF NOT EXISTS idx_assignments_assigned ON email_assignments(assigned_to);
CREATE INDEX IF NOT EXISTS idx_assignments_inbox ON email_assignments(inbox_group_id);
CREATE INDEX IF NOT EXISTS idx_assignment_rules_inbox ON inbox_assignment_rules(inbox_group_id);

ALTER TABLE email_assignments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all" ON email_assignments FOR ALL USING (true);
GRANT ALL ON email_assignments TO anon, authenticated;
GRANT USAGE, SELECT ON SEQUENCE email_assignments_id_seq TO anon, authenticated;

ALTER TABLE inbox_assignment_rules ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all" ON inbox_assignment_rules FOR ALL USING (true);
GRANT ALL ON inbox_assignment_rules TO anon, authenticated;
GRANT USAGE, SELECT ON SEQUENCE inbox_assignment_rules_id_seq TO anon, authenticated;

ALTER TABLE email_assignment_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all" ON email_assignment_log FOR ALL USING (true);
GRANT ALL ON email_assignment_log TO anon, authenticated;
GRANT USAGE, SELECT ON SEQUENCE email_assignment_log_id_seq TO anon, authenticated;
