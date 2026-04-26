-- Lock the tasks table to server-side access only.
--
-- Background: migration 017 added Outlook sync columns but left the
-- pre-existing RLS posture untouched. The application now goes through
-- /api/tasks (which enforces visibility rules: own + assigned for staff,
-- team scope for managers, all for super_admin). Without RLS, anyone
-- holding the public anon key could query the tasks table directly and
-- see every staff member's task list.
--
-- Posture: ENABLE RLS, drop any "Allow all" legacy policy, REVOKE table
-- privileges from anon / authenticated. The service-role key (used only
-- on the server in /src/services/base.ts) bypasses RLS and remains the
-- single read/write path.

ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;

-- Drop any legacy permissive policies so they cannot quietly re-grant
-- access. Names are taken from the patterns used elsewhere in the schema
-- (migrations 005, 006). DROP IF EXISTS is a no-op if not present.
DROP POLICY IF EXISTS "Allow all" ON tasks;
DROP POLICY IF EXISTS "tasks_select_all" ON tasks;
DROP POLICY IF EXISTS "tasks_insert_all" ON tasks;
DROP POLICY IF EXISTS "tasks_update_all" ON tasks;
DROP POLICY IF EXISTS "tasks_delete_all" ON tasks;

-- Explicit deny for anon and authenticated. RLS with no matching policy
-- denies by default, but revoking grants is belt-and-braces in case a
-- future migration adds a permissive policy.
REVOKE ALL ON tasks FROM anon;
REVOKE ALL ON tasks FROM authenticated;

-- Same lockdown for the sequence so the anon role cannot read the next
-- id and infer task volume.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_class WHERE relname = 'tasks_id_seq' AND relkind = 'S'
  ) THEN
    EXECUTE 'REVOKE ALL ON SEQUENCE tasks_id_seq FROM anon';
    EXECUTE 'REVOKE ALL ON SEQUENCE tasks_id_seq FROM authenticated';
  END IF;
END $$;

-- Service role is implicitly granted via Supabase's role hierarchy and
-- bypasses RLS, so no explicit policy is required for the API path.
