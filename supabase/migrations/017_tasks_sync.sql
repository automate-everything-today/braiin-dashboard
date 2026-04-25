-- Tasks 2-way sync columns and source linking. The tasks table already
-- exists; this migration extends it for:
--   1. Outlook ToDo round-trip - outlook_task_id is the Graph-side
--      identifier so we can update / delete the same task we created.
--      last_synced_at gates the cron-pull "modified since" query.
--   2. Source linking - source_type + source_id let us trace a task
--      back to whatever spawned it (an email, a deal, an incident,
--      a manually-typed entry). Used by the AI auto-task suggestion
--      flow and by the /tasks page so a task card can deep-link into
--      its origin.

ALTER TABLE tasks ADD COLUMN IF NOT EXISTS outlook_task_id TEXT;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS outlook_list_id TEXT;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS last_synced_at TIMESTAMPTZ;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS sync_status TEXT;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS source_type TEXT;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS source_id TEXT;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS source_url TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'tasks_sync_status_check'
  ) THEN
    ALTER TABLE tasks
      ADD CONSTRAINT tasks_sync_status_check
      CHECK (sync_status IS NULL OR sync_status IN ('synced','pending','error','disabled'));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'tasks_source_type_check'
  ) THEN
    ALTER TABLE tasks
      ADD CONSTRAINT tasks_source_type_check
      CHECK (source_type IS NULL OR source_type IN ('manual','email','deal','incident','ai'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS tasks_assigned_status_idx
  ON tasks (assigned_to, status);

CREATE INDEX IF NOT EXISTS tasks_outlook_id_idx
  ON tasks (outlook_task_id)
  WHERE outlook_task_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS tasks_source_idx
  ON tasks (source_type, source_id)
  WHERE source_type IS NOT NULL;
