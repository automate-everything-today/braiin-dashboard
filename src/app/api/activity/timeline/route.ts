/**
 * Timeline read API for the Stream module.
 *
 * GET /api/activity/timeline
 *   ?subjectType=deal&subjectId=DL-00123
 *   &before=2026-04-27T08:00:00Z   (cursor; ISO timestamp)
 *   &limit=50                       (default 50, max 200)
 *   &kind=external                  (filter by entry_kind; default: all)
 *
 * Returns events for the given subject, ordered occurred_at DESC.
 * Includes events linked via activity.event_links as secondary
 * subjects, so an email primary-bound to a shipment but linked to
 * a deal also surfaces on the deal's timeline.
 *
 * Auth: cookie session. The current org is implicit (Corten as
 * tenant zero); when the multi-tenant cookie carries an org_id,
 * extend the read here.
 *
 * Visibility: filters by events.visibility against the staff
 * member's role. Margin discussions stay hidden from reps.
 */

import { supabase } from "@/services/base";
import { getSession } from "@/lib/session";
import { TENANT_ZERO_ORG_ID } from "@/lib/activity/log-event";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

interface TimelineEvent {
  event_id: string;
  occurred_at: string;
  event_type: string;
  direction: string;
  channel: string;
  subject_type: string;
  subject_id: string;
  secondary_ref: string | null;
  counterparty_type: string | null;
  counterparty_email: string | null;
  title: string;
  body: string | null;
  status: string;
  visibility: string;
  responsibility: string | null;
  is_pinned: boolean;
  thread_id: string | null;
  entry_kind: string;
  attachments: unknown;
  metadata: unknown;
  awaiting_response_until: string | null;
  created_by: string;
}

interface ActivityClient {
  from(table: string): TimelineQuery;
}

interface TimelineQuery {
  select: (cols: string) => TimelineFilters;
}

interface TimelineFilters {
  eq: (col: string, val: unknown) => TimelineFilters;
  in: (col: string, vals: unknown[]) => TimelineFilters;
  lt: (col: string, val: unknown) => TimelineFilters;
  or: (filters: string) => TimelineFilters;
  order: (col: string, opts: { ascending: boolean }) => TimelineFilters;
  limit: (n: number) => Promise<{ data: TimelineEvent[] | null; error: { message: string } | null }>;
}

function activityClient(): ActivityClient {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (supabase as any).schema("activity") as ActivityClient;
}

interface LinkRow { event_id: string; }
interface LinkClient {
  from(table: string): {
    select: (cols: string) => {
      eq: (col: string, val: unknown) => {
        eq: (col: string, val: unknown) => {
          eq: (col: string, val: unknown) => Promise<{ data: LinkRow[] | null; error: { message: string } | null }>;
        };
      };
    };
  };
}
function linkClient(): LinkClient {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (supabase as any).schema("activity") as LinkClient;
}

// ============================================================
// Visibility -> role gate
//
// Phase 1.5 follow-up will move this into a DB-layer policy. For
// now, the API enforces it. Roles in core.staff_org_membership:
//   rep, branch_manager, regional_manager, commercial_director,
//   operations, finance, super_admin
// ============================================================

function visibleToRole(role: string): string[] {
  switch (role) {
    case "super_admin":
    case "commercial_director":
      return ["public_to_org", "restricted_to_owner_chain", "manager_plus", "directors_plus"];
    case "regional_manager":
    case "branch_manager":
    case "operations":
    case "finance":
      return ["public_to_org", "restricted_to_owner_chain", "manager_plus"];
    default:
      return ["public_to_org", "restricted_to_owner_chain"];
  }
}

export async function GET(req: Request) {
  const session = await getSession();
  if (!session?.email) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }

  const url = new URL(req.url);
  const subjectType = url.searchParams.get("subjectType");
  const subjectId = url.searchParams.get("subjectId");
  if (!subjectType || !subjectId) {
    return Response.json({ error: "subjectType and subjectId are required" }, { status: 400 });
  }

  const before = url.searchParams.get("before");
  const limitRaw = parseInt(url.searchParams.get("limit") ?? `${DEFAULT_LIMIT}`, 10);
  const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), MAX_LIMIT) : DEFAULT_LIMIT;
  const kind = url.searchParams.get("kind");

  const role = session.role || "rep";
  const allowedVisibilities = visibleToRole(role);
  const orgId = TENANT_ZERO_ORG_ID;

  // Step 1: collect event_ids that are SECONDARY-linked to this subject
  // via activity.event_links (the primary-bound rows are caught by the
  // events query directly).
  const lc = linkClient();
  const linkResult = await lc
    .from("event_links")
    .select("event_id")
    .eq("org_id", orgId)
    .eq("subject_type", subjectType)
    .eq("subject_id", subjectId);

  if (linkResult.error) {
    console.error(`[activity/timeline] event_links lookup failed: ${linkResult.error.message}`);
    return Response.json({ error: "Failed to load timeline" }, { status: 500 });
  }
  const linkedEventIds = (linkResult.data ?? []).map((r) => r.event_id).filter(Boolean);

  // Step 2: fetch events that are EITHER primary-linked to this subject
  // OR appear in the linkedEventIds set.
  const ac = activityClient();
  let q = ac
    .from("events")
    .select(
      "event_id, occurred_at, event_type, direction, channel, subject_type, subject_id, " +
      "secondary_ref, counterparty_type, counterparty_email, title, body, status, " +
      "visibility, responsibility, is_pinned, thread_id, entry_kind, attachments, " +
      "metadata, awaiting_response_until, created_by",
    )
    .eq("org_id", orgId)
    .in("visibility", allowedVisibilities);

  if (kind && (kind === "external" || kind === "internal_comment" || kind === "draft")) {
    q = q.eq("entry_kind", kind);
  }

  // Match either primary subject OR linked secondary subject
  if (linkedEventIds.length === 0) {
    q = q.eq("subject_type", subjectType).eq("subject_id", subjectId);
  } else {
    const linkedList = linkedEventIds.map((id) => `"${id}"`).join(",");
    q = q.or(
      `and(subject_type.eq.${subjectType},subject_id.eq.${subjectId}),event_id.in.(${linkedList})`,
    );
  }

  if (before) {
    q = q.lt("occurred_at", before);
  }

  q = q.order("occurred_at", { ascending: false });

  const { data, error } = await q.limit(limit);
  if (error) {
    console.error(`[activity/timeline] events query failed: ${error.message}`);
    return Response.json({ error: "Failed to load timeline" }, { status: 500 });
  }

  const events = data ?? [];
  const nextBefore = events.length === limit ? events[events.length - 1]?.occurred_at : null;

  return Response.json({
    events,
    pagination: {
      limit,
      next_before: nextBefore,
      has_more: events.length === limit,
    },
  });
}
