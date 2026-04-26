import { supabase } from "@/services/base";
import { OUTLOOK_TASKS_SYNC_ENABLED, listTasksSince } from "@/lib/outlook-todo";

/**
 * Pull-side reconciliation. Every 15 min, ask Graph "what tasks have
 * been modified since I last looked?" per user-and-list-id pair we
 * already track in tasks. Update local row when remote is newer.
 *
 * Doesn't insert tasks created in Outlook (no matching local row) for
 * v1 - avoids race with the push-side and the unanswered question of
 * "who do we assign an Outlook-created task to in Braiin's silo model".
 * That's a follow-up.
 *
 * No-ops when OUTLOOK_TASKS_SYNC_ENABLED is false.
 */

export async function GET(req: Request) {
  const authHeader = req.headers.get("authorization") || "";
  const expected = `Bearer ${process.env.CRON_SECRET || ""}`;
  if (!process.env.CRON_SECRET || authHeader !== expected) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }
  if (!OUTLOOK_TASKS_SYNC_ENABLED) {
    return Response.json({ skipped: "OUTLOOK_TASKS_SYNC_ENABLED is false" });
  }

  // Distinct (assigned_to, outlook_list_id) pairs that have been synced
  // at least once. We only poll lists we've already pushed to.
  const { data: synced } = await supabase
    .from("tasks")
    .select("assigned_to, outlook_list_id, last_synced_at")
    .not("outlook_task_id", "is", null)
    .not("outlook_list_id", "is", null);

  const pairs = new Map<string, { userEmail: string; listId: string; sinceIso: string }>();
  for (const r of (synced || []) as Array<{ assigned_to?: string | null; outlook_list_id?: string | null; last_synced_at?: string | null }>) {
    const userEmail = (r.assigned_to || "").toLowerCase();
    const listId = r.outlook_list_id || "";
    if (!userEmail || !listId) continue;
    const key = `${userEmail}::${listId}`;
    const existing = pairs.get(key);
    const ts = r.last_synced_at || new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    if (!existing || ts < existing.sinceIso) {
      pairs.set(key, { userEmail, listId, sinceIso: ts });
    }
  }

  let updated = 0;
  let polled = 0;
  for (const { userEmail, listId, sinceIso } of pairs.values()) {
    polled++;
    const remote = await listTasksSince({ userEmail, listId, sinceIso });
    for (const r of remote) {
      const { data: local } = await supabase
        .from("tasks")
        .select("id, title, status, last_synced_at")
        .eq("outlook_task_id", r.id)
        .maybeSingle();
      if (!local) continue;

      // Skip if we just pushed this update ourselves: lastModified within
      // 30s of last_synced_at usually means our own write echoing back.
      const lastSynced = (local as { last_synced_at?: string | null }).last_synced_at;
      if (lastSynced && r.lastModifiedDateTime) {
        const diffMs = new Date(r.lastModifiedDateTime).getTime() - new Date(lastSynced).getTime();
        if (Math.abs(diffMs) < 30_000) continue;
      }

      const remoteStatus =
        r.status === "completed"
          ? "completed"
          : r.status === "inProgress"
            ? "in_progress"
            : "open";
      await supabase
        .from("tasks")
        .update({
          title: r.title,
          status: remoteStatus,
          completed_at: remoteStatus === "completed" ? new Date().toISOString() : null,
          last_synced_at: new Date().toISOString(),
          sync_status: "synced",
        } as never)
        .eq("id", (local as { id: number }).id);
      updated++;
    }
  }

  return Response.json({ polled_pairs: polled, updated });
}
