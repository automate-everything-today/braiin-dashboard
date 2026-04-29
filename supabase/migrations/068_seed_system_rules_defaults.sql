-- Migration 068: seed default rules so the system works out of the box.
-- baseline_template is intentionally empty; operator authors via /dev/system-rules.

BEGIN;

INSERT INTO system_rules (category, key, value, notes) VALUES
('seniority_score', 'weights', '{
  "ceo": 100, "founder": 95, "owner": 95, "president": 95,
  "managing_director": 95, "md": 95,
  "director": 80, "head": 75, "vp": 75,
  "manager": 60, "lead": 60,
  "analyst": 40, "coordinator": 40, "executive": 40, "exec": 40,
  "default_unknown": 20
}'::jsonb, 'Title-keyword to seniority score (0-100). Highest match wins.'),

('company_match', 'canonicalisation', '{
  "strip_suffixes": ["Ltd","Inc","SA","SAS","SL","SLU","GmbH","AG","BV","NV","Group","Logistics","Cargo","Shipping","Worldwide","International","Co","Corp","LLC"],
  "treat_and_equal": true,
  "strip_punctuation": true,
  "lowercase": true
}'::jsonb, 'Canonicalisation rules used for company-grouping equivalence.'),

('granola_match', 'thresholds', '{
  "auto_link_threshold": 80,
  "review_floor": 50,
  "date_buffer_days": 2
}'::jsonb, 'Granola match confidence cutoffs and date proximity window.'),

('model_routing', 'tasks', '{
  "seniority_score": "claude-haiku-4-5",
  "company_canonicalisation": "claude-haiku-4-5",
  "granola_match": "claude-haiku-4-5",
  "already_engaged_summary": "claude-haiku-4-5",
  "draft_email": "claude-sonnet-4-6",
  "voice_lint_regenerate": "claude-sonnet-4-6",
  "baseline_template_authoring": "claude-sonnet-4-6"
}'::jsonb, 'Per-task model assignment. Edit via /dev/system-rules.');

COMMIT;
