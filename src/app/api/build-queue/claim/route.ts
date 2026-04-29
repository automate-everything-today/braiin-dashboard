// POST /api/build-queue/claim - personal-token authenticated.
// Atomically claims the next queued item (highest priority, oldest first)
// and returns it. Used by the local helper script ~/bin/braiin-pull.

import { supabase } from "@/services/base";
import { getOrgId } from "@/lib/org";
import { verifyPersonalToken } from "@/lib/personal-token";
import { logBuildEntry } from "@/lib/security/log";

const ROUTE = "/api/build-queue/claim";
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as unknown as { schema: (s: string) => any };

const PRIORITY_RANK: Record<string, number> = { urgent: 0, high: 1, medium: 2, low: 3 };

export async function POST(req: Request) {
  const tokenHeader = req.headers.get("authorization");
  if (!tokenHeader?.startsWith("Bearer bra_")) {
    return Response.json({ error: "Bearer bra_* token required" }, { status: 401 });
  }
  const verified = await verifyPersonalToken(tokenHeader.slice(7));
  if (!verified) return Response.json({ error: "Invalid token" }, { status: 401 });

  const machine = req.headers.get("x-claimer-machine") ?? "unknown";

  // Get all queued items, sort by priority then created_at, claim the head.
  const { data, error } = await db
    .schema("feedback")
    .from("build_queue")
    .select("*")
    .eq("org_id", getOrgId())
    .eq("status", "queued")
    .limit(50);
  if (error) return Response.json({ error: error.message }, { status: 500 });
  const items = (data ?? []) as Array<{ queue_id: string; priority: string; created_at: string }>;
  if (items.length === 0) {
    return Response.json({ ok: true, item: null, remaining: 0 });
  }
  items.sort((a, b) => {
    const dp = (PRIORITY_RANK[a.priority] ?? 9) - (PRIORITY_RANK[b.priority] ?? 9);
    if (dp !== 0) return dp;
    return a.created_at.localeCompare(b.created_at);
  });
  const next = items[0];

  // Optimistic claim: only succeeds if status is still 'queued'.
  const { data: claimed, error: claimErr } = await db
    .schema("feedback")
    .from("build_queue")
    .update({ status: "claimed", claimed_at: new Date().toISOString(), claimed_by: verified.user_email, claimed_machine: machine })
    .eq("queue_id", next.queue_id)
    .eq("status", "queued")
    .select()
    .single();
  if (claimErr || !claimed) {
    return Response.json({ ok: true, item: null, remaining: items.length, note: "race lost; retry" });
  }

  void logBuildEntry({
    title: `🔨 Build claimed by ${verified.user_email}`,
    summary: `From queue: ${(claimed as { title: string }).title.slice(0, 100)}`,
    item_type: "chore", area: "build-queue", tags: ["claim", machine],
    author: verified.user_email,
    notes: `claimed via ${ROUTE}`,
  });

  return Response.json({ ok: true, item: claimed, remaining: items.length - 1 });
}
