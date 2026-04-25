import { supabase } from "@/services/base";
import { getSession } from "@/lib/session";
import { apiError, apiResponse } from "@/lib/validation";
import { z } from "zod";
import {
  OUTLOOK_TASKS_SYNC_ENABLED,
  getDefaultListId,
  createOutlookTask,
  updateOutlookTask,
  deleteOutlookTask,
} from "@/lib/outlook-todo";

/**
 * REST CRUD for Tasks. Replaces the direct Supabase calls from the
 * /tasks page so we can enforce visibility rules + sync to Outlook ToDo.
 *
 * Visibility (default behaviour, overridable by managers via ?scope=team):
 *   - Regular staff see tasks they own (assigned_to=self) or created.
 *   - Managers see their own + tasks assigned to anyone in their team.
 *   - super_admin sees everything.
 *
 * Outlook sync is gated by OUTLOOK_TASKS_SYNC_ENABLED. When off, every
 * task is local-only and sync_status='disabled'.
 */

const createSchema = z.object({
  title: z.string().min(1).max(500),
  description: z.string().max(5000).nullable().optional(),
  account_code: z.string().max(120).nullable().optional(),
  deal_id: z.number().int().nullable().optional(),
  assigned_to: z.string().email().nullable().optional(),
  due_date: z.string().nullable().optional(),
  priority: z.enum(["urgent", "high", "medium", "low"]).default("medium"),
  source_type: z.enum(["manual", "email", "deal", "incident", "ai"]).default("manual"),
  source_id: z.string().max(500).nullable().optional(),
  source_url: z.string().max(1000).nullable().optional(),
});

const updateSchema = z.object({
  id: z.number().int().positive(),
  title: z.string().min(1).max(500).optional(),
  description: z.string().max(5000).nullable().optional(),
  assigned_to: z.string().email().nullable().optional(),
  due_date: z.string().nullable().optional(),
  priority: z.enum(["urgent", "high", "medium", "low"]).optional(),
  status: z.enum(["open", "in_progress", "completed", "cancelled"]).optional(),
});

async function isManager(email: string): Promise<boolean> {
  const { data } = await supabase
    .from("staff")
    .select("is_manager")
    .eq("email", email.toLowerCase())
    .maybeSingle();
  return Boolean((data as { is_manager?: boolean } | null)?.is_manager);
}

export async function GET(req: Request) {
  const session = await getSession();
  if (!session?.email) return apiError("Not authenticated", 401);

  const url = new URL(req.url);
  const filter = url.searchParams.get("filter") || "open";
  const scope = url.searchParams.get("scope") || "mine";
  const me = session.email.toLowerCase();

  let query = supabase
    .from("tasks")
    .select("*")
    .order("due_date", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: false })
    .limit(500);

  if (filter === "open") query = query.in("status", ["open", "in_progress"]);
  else if (filter === "completed") query = query.eq("status", "completed");
  else if (filter === "overdue") {
    const today = new Date().toISOString().split("T")[0];
    query = query.in("status", ["open", "in_progress"]).lt("due_date", today);
  }

  // Visibility scope. super_admin sees everything; managers can pass
  // scope=team to see their team; everyone else sees own + assigned.
  if (session.role !== "super_admin") {
    if (scope === "team" && (await isManager(me))) {
      // Manager team scope: own department's staff
      const { data: dept } = await supabase
        .from("staff")
        .select("email")
        .eq("department", session.department || "")
        .eq("is_active", true);
      const emails = ((dept || []) as Array<{ email?: string | null }>)
        .map((d) => (d.email || "").toLowerCase())
        .filter(Boolean);
      if (emails.length > 0) {
        query = query.or(`assigned_to.in.(${emails.join(",")}),created_by.eq.${me}`);
      } else {
        query = query.or(`assigned_to.eq.${me},created_by.eq.${me}`);
      }
    } else {
      query = query.or(`assigned_to.eq.${me},created_by.eq.${me}`);
    }
  }

  const { data, error } = await query;
  if (error) return apiError(error.message, 500);
  return apiResponse({ tasks: data ?? [] });
}

export async function POST(req: Request) {
  const session = await getSession();
  if (!session?.email) return apiError("Not authenticated", 401);

  const body = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return apiError(
      `Validation failed: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join(", ")}`,
      400,
    );
  }
  const input = parsed.data;
  const me = session.email.toLowerCase();
  const assignee = (input.assigned_to || me).toLowerCase();

  // Insert local row first, then push to Outlook. If Outlook fails the
  // task still exists locally with sync_status='pending' and the cron
  // (when added) can retry.
  const insertPayload: Record<string, unknown> = {
    title: input.title,
    description: input.description ?? null,
    account_code: input.account_code ?? null,
    deal_id: input.deal_id ?? null,
    assigned_to: assignee,
    created_by: me,
    due_date: input.due_date ?? null,
    priority: input.priority,
    status: "open",
    source_type: input.source_type,
    source_id: input.source_id ?? null,
    source_url: input.source_url ?? null,
    sync_status: OUTLOOK_TASKS_SYNC_ENABLED ? "pending" : "disabled",
  };
  const { data: created, error: insertErr } = await supabase
    .from("tasks")
    .insert(insertPayload as never)
    .select()
    .single();
  if (insertErr) return apiError(insertErr.message, 500);

  if (OUTLOOK_TASKS_SYNC_ENABLED) {
    const listId = await getDefaultListId(assignee);
    if (listId) {
      const remote = await createOutlookTask({
        userEmail: assignee,
        listId,
        title: input.title,
        description: input.description ?? null,
        dueDate: input.due_date ?? null,
        priority: input.priority,
      });
      if (remote?.id) {
        await supabase
          .from("tasks")
          .update({
            outlook_task_id: remote.id,
            outlook_list_id: listId,
            last_synced_at: new Date().toISOString(),
            sync_status: "synced",
          } as never)
          .eq("id", (created as { id: number }).id);
      } else {
        await supabase
          .from("tasks")
          .update({ sync_status: "error" } as never)
          .eq("id", (created as { id: number }).id);
      }
    }
  }

  const { data: final } = await supabase
    .from("tasks")
    .select("*")
    .eq("id", (created as { id: number }).id)
    .single();
  return apiResponse({ task: final });
}

export async function PATCH(req: Request) {
  const session = await getSession();
  if (!session?.email) return apiError("Not authenticated", 401);

  const body = await req.json().catch(() => null);
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) {
    return apiError(
      `Validation failed: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join(", ")}`,
      400,
    );
  }
  const { id, ...patch } = parsed.data;

  const { data: existing, error: loadErr } = await supabase
    .from("tasks")
    .select("*")
    .eq("id", id)
    .single();
  if (loadErr) return apiError(loadErr.message, 500);
  if (!existing) return apiError("Task not found", 404);

  const me = session.email.toLowerCase();
  const row = existing as Record<string, unknown>;
  const ownerOk =
    session.role === "super_admin" ||
    row.assigned_to === me ||
    row.created_by === me;
  if (!ownerOk && !(await isManager(me))) {
    return apiError("Forbidden", 403);
  }

  const updates: Record<string, unknown> = {};
  if (patch.title !== undefined) updates.title = patch.title;
  if (patch.description !== undefined) updates.description = patch.description;
  if (patch.assigned_to !== undefined) updates.assigned_to = patch.assigned_to;
  if (patch.due_date !== undefined) updates.due_date = patch.due_date;
  if (patch.priority !== undefined) updates.priority = patch.priority;
  if (patch.status !== undefined) {
    updates.status = patch.status;
    updates.completed_at = patch.status === "completed" ? new Date().toISOString() : null;
  }

  const { error: updateErr } = await supabase
    .from("tasks")
    .update(updates as never)
    .eq("id", id);
  if (updateErr) return apiError(updateErr.message, 500);

  if (OUTLOOK_TASKS_SYNC_ENABLED && row.outlook_task_id && row.outlook_list_id) {
    const ok = await updateOutlookTask({
      userEmail: ((row.assigned_to as string) || me).toLowerCase(),
      listId: row.outlook_list_id as string,
      taskId: row.outlook_task_id as string,
      patch,
    });
    await supabase
      .from("tasks")
      .update({
        sync_status: ok ? "synced" : "error",
        last_synced_at: new Date().toISOString(),
      } as never)
      .eq("id", id);
  }

  const { data: final } = await supabase
    .from("tasks")
    .select("*")
    .eq("id", id)
    .single();
  return apiResponse({ task: final });
}

export async function DELETE(req: Request) {
  const session = await getSession();
  if (!session?.email) return apiError("Not authenticated", 401);
  const url = new URL(req.url);
  const id = parseInt(url.searchParams.get("id") || "0");
  if (!id) return apiError("id required", 400);

  const { data: existing } = await supabase
    .from("tasks")
    .select("*")
    .eq("id", id)
    .single();
  if (!existing) return apiError("Task not found", 404);
  const row = existing as Record<string, unknown>;
  const me = session.email.toLowerCase();
  const ownerOk =
    session.role === "super_admin" ||
    row.created_by === me ||
    row.assigned_to === me;
  if (!ownerOk && !(await isManager(me))) {
    return apiError("Forbidden", 403);
  }

  if (OUTLOOK_TASKS_SYNC_ENABLED && row.outlook_task_id && row.outlook_list_id) {
    await deleteOutlookTask({
      userEmail: ((row.assigned_to as string) || me).toLowerCase(),
      listId: row.outlook_list_id as string,
      taskId: row.outlook_task_id as string,
    });
  }

  const { error } = await supabase.from("tasks").delete().eq("id", id);
  if (error) return apiError(error.message, 500);
  return apiResponse({ success: true });
}
