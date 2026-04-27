/**
 * Dev smoke-test feed for the Cargowise TMS adapter.
 *
 * GET /api/dev/cargowise-recent?limit=50
 *
 * Returns:
 *   - Last N rows from tms.events
 *   - Last N rows from tms.subscriptions
 *   - Configured tms.connections (provider/name/auth_method only - no secrets)
 *
 * Used by /dev/cargowise to monitor the inbound webhook -> events
 * loop and the subscription lifecycle.
 *
 * Auth: cookie session via the global proxy. Service-role on the
 * schema query because tms.* is locked to service role only.
 */

import { supabase } from "@/services/base";
import { TENANT_ZERO_ORG_ID } from "@/lib/activity/log-event";

interface RecentEvent {
  event_id: string;
  provider_id: string;
  event_type: string;
  event_time: string | null;
  received_at: string;
  client_reference: string | null;
  tms_ref: string | null;
  tms_ref_type: string | null;
  status: string;
  error_message: string | null;
}

interface RecentSubscription {
  subscription_id: string;
  provider_id: string;
  tms_ref: string;
  tms_ref_type: string;
  carrier_code: string | null;
  transport_mode: string | null;
  client_reference: string;
  status: string;
  rejection_reason: string | null;
  created_at: string;
  acknowledged_at: string | null;
  rejected_at: string | null;
}

interface ConnectionRow {
  connection_id: string;
  provider_id: string;
  name: string;
  auth_method: string;
  enabled: boolean;
  created_at: string;
}

interface TmsClient {
  from(table: string): {
    select: (cols: string) => {
      eq: (col: string, val: unknown) => {
        order: (col: string, opts: { ascending: boolean }) => {
          limit: (n: number) => Promise<{
            data: unknown[] | null;
            error: { message: string } | null;
          }>;
        };
      };
    };
  };
}

function tmsClient(): TmsClient {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (supabase as any).schema("tms") as TmsClient;
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const limitParam = Number(url.searchParams.get("limit") ?? 50);
  const limit = Math.min(Math.max(Number.isFinite(limitParam) ? limitParam : 50, 1), 200);

  const eventsP = tmsClient()
    .from("events")
    .select(
      "event_id,provider_id,event_type,event_time,received_at,client_reference,tms_ref,tms_ref_type,status,error_message",
    )
    .eq("org_id", TENANT_ZERO_ORG_ID)
    .order("received_at", { ascending: false })
    .limit(limit);

  const subsP = tmsClient()
    .from("subscriptions")
    .select(
      "subscription_id,provider_id,tms_ref,tms_ref_type,carrier_code,transport_mode,client_reference,status,rejection_reason,created_at,acknowledged_at,rejected_at",
    )
    .eq("org_id", TENANT_ZERO_ORG_ID)
    .order("created_at", { ascending: false })
    .limit(limit);

  const connsP = tmsClient()
    .from("connections")
    .select("connection_id,provider_id,name,auth_method,enabled,created_at")
    .eq("org_id", TENANT_ZERO_ORG_ID)
    .order("created_at", { ascending: false })
    .limit(20);

  const [eventsR, subsR, connsR] = await Promise.all([eventsP, subsP, connsP]);

  if (eventsR.error || subsR.error || connsR.error) {
    return Response.json(
      {
        error: "Failed to load",
        details: {
          events: eventsR.error?.message,
          subscriptions: subsR.error?.message,
          connections: connsR.error?.message,
        },
      },
      { status: 500 },
    );
  }

  return Response.json({
    events: (eventsR.data ?? []) as RecentEvent[],
    subscriptions: (subsR.data ?? []) as RecentSubscription[],
    connections: (connsR.data ?? []) as ConnectionRow[],
  });
}
