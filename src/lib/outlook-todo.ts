/**
 * Microsoft Graph wrappers for the Outlook ToDo (Tasks) API.
 *
 * Gated by OUTLOOK_TASKS_SYNC_ENABLED. When false (default), every helper
 * is a no-op so the local Tasks API works fully without Graph permissions.
 * Flip the flag once Tasks.ReadWrite.All admin consent is granted on the
 * Azure app registration.
 *
 * App-level Graph token (same client_credentials flow as email-sync) is
 * used for all calls so we don't need delegated user tokens. Required
 * scope: Tasks.ReadWrite.All.
 */

const CLIENT_ID = process.env.AZURE_CLIENT_ID || "";
const CLIENT_SECRET = process.env.AZURE_CLIENT_SECRET || "";
const TENANT_ID = process.env.AZURE_TENANT_ID || "";

export const OUTLOOK_TASKS_SYNC_ENABLED =
  process.env.OUTLOOK_TASKS_SYNC_ENABLED === "true";

export type OutlookTask = {
  id: string;
  title: string;
  body?: { content?: string; contentType?: string };
  status?: "notStarted" | "inProgress" | "completed" | "waitingOnOthers" | "deferred";
  importance?: "low" | "normal" | "high";
  dueDateTime?: { dateTime: string; timeZone: string };
  lastModifiedDateTime?: string;
};

// Module-level token cache. App-only tokens are valid for ~1 hour;
// without caching, a single task POST can trigger 3 token fetches
// (getDefaultListId, createOutlookTask, sync-status update) and the
// 15-min sync cron compounds the cost. Refreshes 60s before expiry to
// avoid serving a token that races with its own expiration.
let cachedToken: { value: string; expiresAt: number } | null = null;
const TOKEN_REFRESH_BUFFER_MS = 60_000;

async function fetchFreshToken(): Promise<{ value: string; expiresAt: number } | null> {
  try {
    const res = await fetch(`https://login.microsoftonline.com/${TENANT_ID}/oauth2/v2.0/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        scope: "https://graph.microsoft.com/.default",
        grant_type: "client_credentials",
      }),
    });
    const data = await res.json();
    if (!data.access_token) {
      console.error("[outlook-todo] getAppToken: no access_token", data.error || data);
      return null;
    }
    // expires_in is seconds (typically 3599). Subtract the refresh
    // buffer so callers never get a token that's about to expire.
    const ttlMs = (Number(data.expires_in) || 3600) * 1000;
    return {
      value: data.access_token as string,
      expiresAt: Date.now() + ttlMs - TOKEN_REFRESH_BUFFER_MS,
    };
  } catch (err) {
    console.error("[outlook-todo] getAppToken failed:", err);
    return null;
  }
}

async function getAppToken(): Promise<string | null> {
  if (cachedToken && cachedToken.expiresAt > Date.now()) {
    return cachedToken.value;
  }
  const fresh = await fetchFreshToken();
  if (!fresh) {
    cachedToken = null;
    return null;
  }
  cachedToken = fresh;
  return fresh.value;
}

/**
 * Resolve the user's default ToDo list id (the "Tasks" list every M365
 * mailbox has). Required because every task call is scoped to a list.
 */
export async function getDefaultListId(userEmail: string): Promise<string | null> {
  if (!OUTLOOK_TASKS_SYNC_ENABLED) return null;
  const token = await getAppToken();
  if (!token) return null;
  const res = await fetch(
    `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(userEmail)}/todo/lists?$filter=wellknownListName eq 'defaultList'`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!res.ok) {
    console.warn("[outlook-todo] getDefaultListId failed:", res.status, await res.text());
    return null;
  }
  const data = await res.json();
  return (data.value?.[0]?.id as string) || null;
}

export async function createOutlookTask(params: {
  userEmail: string;
  listId: string;
  title: string;
  description?: string | null;
  dueDate?: string | null;
  priority?: string | null;
}): Promise<OutlookTask | null> {
  if (!OUTLOOK_TASKS_SYNC_ENABLED) return null;
  const token = await getAppToken();
  if (!token) return null;

  const body: Record<string, unknown> = { title: params.title };
  if (params.description) {
    body.body = { content: params.description, contentType: "text" };
  }
  if (params.dueDate) {
    body.dueDateTime = { dateTime: new Date(params.dueDate).toISOString(), timeZone: "UTC" };
  }
  if (params.priority === "urgent" || params.priority === "high") {
    body.importance = "high";
  } else if (params.priority === "low") {
    body.importance = "low";
  }

  const res = await fetch(
    `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(params.userEmail)}/todo/lists/${params.listId}/tasks`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  );
  if (!res.ok) {
    console.warn("[outlook-todo] createOutlookTask failed:", res.status, await res.text());
    return null;
  }
  return (await res.json()) as OutlookTask;
}

export async function updateOutlookTask(params: {
  userEmail: string;
  listId: string;
  taskId: string;
  patch: Partial<{ title: string; description: string | null; dueDate: string | null; status: string }>;
}): Promise<boolean> {
  if (!OUTLOOK_TASKS_SYNC_ENABLED) return false;
  const token = await getAppToken();
  if (!token) return false;
  const body: Record<string, unknown> = {};
  if (params.patch.title !== undefined) body.title = params.patch.title;
  if (params.patch.description !== undefined) {
    body.body = params.patch.description
      ? { content: params.patch.description, contentType: "text" }
      : null;
  }
  if (params.patch.dueDate !== undefined) {
    body.dueDateTime = params.patch.dueDate
      ? { dateTime: new Date(params.patch.dueDate).toISOString(), timeZone: "UTC" }
      : null;
  }
  if (params.patch.status === "completed") body.status = "completed";
  else if (params.patch.status === "open") body.status = "notStarted";
  else if (params.patch.status === "in_progress") body.status = "inProgress";
  if (Object.keys(body).length === 0) return true;

  const res = await fetch(
    `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(params.userEmail)}/todo/lists/${params.listId}/tasks/${params.taskId}`,
    {
      method: "PATCH",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  );
  if (!res.ok) {
    console.warn("[outlook-todo] updateOutlookTask failed:", res.status, await res.text());
    return false;
  }
  return true;
}

/**
 * List tasks in a user's default ToDo list modified since `sinceIso`.
 * Used by the cron pull-side to reconcile remote changes back into Braiin.
 * Returns [] when sync is disabled or the call fails - caller treats
 * "no remote changes" the same as "sync not running".
 */
export async function listTasksSince(params: {
  userEmail: string;
  listId: string;
  sinceIso: string;
}): Promise<OutlookTask[]> {
  if (!OUTLOOK_TASKS_SYNC_ENABLED) return [];
  const token = await getAppToken();
  if (!token) return [];
  const filter = encodeURIComponent(`lastModifiedDateTime gt ${params.sinceIso}`);
  const res = await fetch(
    `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(params.userEmail)}/todo/lists/${params.listId}/tasks?$filter=${filter}&$top=100`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!res.ok) {
    console.warn("[outlook-todo] listTasksSince failed:", res.status, await res.text());
    return [];
  }
  const data = await res.json();
  return (data.value as OutlookTask[]) || [];
}

export async function deleteOutlookTask(params: {
  userEmail: string;
  listId: string;
  taskId: string;
}): Promise<boolean> {
  if (!OUTLOOK_TASKS_SYNC_ENABLED) return false;
  const token = await getAppToken();
  if (!token) return false;
  const res = await fetch(
    `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(params.userEmail)}/todo/lists/${params.listId}/tasks/${params.taskId}`,
    {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    },
  );
  return res.ok;
}
