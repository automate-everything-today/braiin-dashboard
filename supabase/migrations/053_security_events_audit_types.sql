-- 053_security_events_audit_types.sql
--
-- Extend feedback.security_events.event_type CHECK constraint with:
--   - super_admin_action: every privileged write logs (Phase 3)
--   - honeypot_hit:       fake admin endpoints flag scanners (Phase 4)
--
-- Idempotent via DROP CONSTRAINT IF EXISTS + ADD CONSTRAINT. Already
-- applied directly via the Management API on first deploy; the file
-- exists for migration ordering consistency.

ALTER TABLE feedback.security_events
    DROP CONSTRAINT IF EXISTS security_events_event_type_check;

ALTER TABLE feedback.security_events
    ADD CONSTRAINT security_events_event_type_check
    CHECK (event_type IN (
        'auth_failure',
        'session_expired',
        'role_denied',
        'upload_rejected',
        'rate_limit_hit',
        'csrf_failure',
        'input_validation_failed',
        'service_key_missing',
        'unusual_activity',
        'super_admin_action',
        'honeypot_hit'
    ));
