-- 025_activity_service_role_grants.sql
--
-- Grants service_role access to the activity schema.
--
-- Migration 024 created the activity schema and locked it down with
-- ALTER DEFAULT PRIVILEGES IN SCHEMA activity REVOKE ALL FROM PUBLIC.
-- That is the right security posture (activity content includes
-- private margin discussions, internal notes, role-gated visibility),
-- but it omitted explicit grants to service_role - and Supabase does
-- NOT auto-grant service_role on user-created schemas.
--
-- Symptom: every server-side `.schema("activity").from(...)` call
-- via supabase-js was failing at the PostgREST layer with PGRST106
-- "Invalid schema: activity". The inbound webhook's logEvent() calls
-- were caught by a `.catch()` block that returned 200 anyway, so
-- CloudMailin showed "Successful Today: N" while activity.events
-- received zero rows.
--
-- This migration restores the grants service_role needs, plus default
-- privileges so future tables/functions/types added to the activity
-- schema inherit the same access without each migration restating them.
--
-- It does NOT relax security for PUBLIC, anon, or authenticated -
-- only service_role, which is server-side-only and bypasses RLS by
-- design. RLS is still the visibility gate for application reads
-- through the API layer.
--
-- IMPORTANT: PostgREST also needs `activity` added to the project's
-- exposed schemas list (Supabase Dashboard -> Settings -> API ->
-- "Schemas that will be exposed via PostgREST"). This migration
-- cannot do that - it is a Supabase project-level config, not a
-- database object. If you apply this migration but skip the
-- dashboard step, calls will still fail with PGRST106.

-- Schema-level USAGE
GRANT USAGE ON SCHEMA activity TO service_role;

-- All current tables (events, event_links, outbound_correlation_tokens,
-- communication_threads, event_annotations, plus 024.5 additions:
-- event_private_recipients, event_seen, ai_suggestions)
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA activity TO service_role;

-- Sequences (for any SERIAL/BIGSERIAL columns and partition naming)
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA activity TO service_role;

-- Functions (logEvent calls activity.*; find_orphans, mark_wiki_stale, etc)
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA activity TO service_role;

-- Types (enum types like event_type, direction, channel are cast
-- explicitly in inserts via supabase-js type coercion).
-- NOTE: Postgres has no `GRANT ON ALL TYPES IN SCHEMA` bulk syntax;
-- types must be granted individually. The ALTER DEFAULT PRIVILEGES
-- block below covers any types created in future migrations.
GRANT USAGE ON TYPE activity.event_type      TO service_role;
GRANT USAGE ON TYPE activity.direction       TO service_role;
GRANT USAGE ON TYPE activity.channel         TO service_role;
GRANT USAGE ON TYPE activity.visibility      TO service_role;
GRANT USAGE ON TYPE activity.responsibility  TO service_role;
GRANT USAGE ON TYPE activity.event_status    TO service_role;
GRANT USAGE ON TYPE activity.entry_kind      TO service_role;
GRANT USAGE ON TYPE activity.suggestion_type TO service_role;

-- Default privileges for future objects added to the schema
ALTER DEFAULT PRIVILEGES IN SCHEMA activity
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO service_role;

ALTER DEFAULT PRIVILEGES IN SCHEMA activity
    GRANT USAGE, SELECT ON SEQUENCES TO service_role;

ALTER DEFAULT PRIVILEGES IN SCHEMA activity
    GRANT EXECUTE ON FUNCTIONS TO service_role;

ALTER DEFAULT PRIVILEGES IN SCHEMA activity
    GRANT USAGE ON TYPES TO service_role;
