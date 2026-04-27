/**
 * Dev smoke-test feed for the Stream module.
 *
 * GET /api/dev/activity-recent?limit=50
 *
 * Returns the last N rows from activity.events for the current
 * tenant, ordered occurred_at DESC. Used by /dev/activity to
 * verify the inbound webhook -> activity backbone loop is
 * actually populating rows after a real email arrives.
 *
 * Auth: cookie session (proxy.ts gates /api/* with the global
 * session middleware). Service-role on the schema query because
 * activity.* is locked down to service role only.
 */

import { supabase } from "@/services/base";
import { TENANT_ZERO_ORG_ID } from "@/lib/activity/log-event";

interface RecentEvent {
  event_id: string;
  occurred_at: string;
  direction: string;
  channel: string;
  event_type: string;
  subject_type: string;
  subject_id: string;
  title: string;
  counterparty_email: string | null;
  correlation_key: string | null;
  status: string;
  created_by: string;
}

interface ActivityClient {
  from(table: string): {
    select: (cols: string) => {
      eq: (col: string, val: unknown) => {
        order: (col: string, opts: { ascending: boolean }) => {
          limit: (n: number) => Promise<{
            data: RecentEvent[] | null;
            error: { message: string } | null;
          }>;
        };
      };
    };
  };
}

function activityClient(): ActivityClient {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (supabase as any).schema("activity") as ActivityClient;
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const limitParam = Number(url.searchParams.get("limit") ?? 50);
  const limit = Math.min(Math.max(Number.isFinite(limitParam) ? limitParam : 50, 1), 200);

  const { data, error } = await activityClient()
    .from("events")
    .select(
      "event_id,occurred_at,direction,channel,event_type,subject_type,subject_id,title,counterparty_email,correlation_key,status,created_by",
    )
    .eq("org_id", TENANT_ZERO_ORG_ID)
    .order("occurred_at", { ascending: false })
    .limit(limit);

  if (error) {
    console.error("[dev/activity-recent] query failed:", error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({ events: data ?? [] });
}
