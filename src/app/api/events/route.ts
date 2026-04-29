/**
 * /api/events - CRUD for the events directory.
 *
 * Read access:    any authenticated staff member.
 * Write access:   manager, sales_manager, super_admin.
 *
 * Includes contact + ROI rollups in GET responses for the /events page
 * to render per-event cards without N+1 queries from the client.
 */

import { z } from "zod";
import { supabase } from "@/services/base";
import { requireAuth, requireManager } from "@/lib/api-auth";
import { apiError, apiResponse, validationError } from "@/lib/validation";
import { convertToGbp, type Currency } from "@/lib/fx";

const ROUTE = "/api/events";

const EVENT_TYPES = ["trade_show", "conference", "network_meeting", "agm", "other"] as const;
const CURRENCIES = ["GBP", "USD", "EUR"] as const;

const createSchema = z.object({
  name: z.string().min(1).max(200),
  event_type: z.enum(EVENT_TYPES).default("trade_show"),
  start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  location: z.string().max(200).nullable().optional(),
  via_network_id: z.number().int().positive().nullable().optional(),
  cost_amount: z.number().nonnegative().nullable().optional(),
  cost_currency: z.enum(CURRENCIES).default("GBP"),
  attendees: z.array(z.string().email()).default([]),
  notes: z.string().max(2000).nullable().optional(),
  context_brief: z.string().max(5000).nullable().optional(),
});

const updateSchema = createSchema.partial().extend({
  id: z.number().int().positive(),
  active: z.boolean().optional(),
});

interface EventRow {
  id: number;
  name: string;
  event_type: string;
  start_date: string;
  end_date: string | null;
  location: string | null;
  via_network_id: number | null;
  cost_amount: number | null;
  cost_currency: Currency;
  attendees: string[];
  notes: string | null;
  active: boolean;
  created_at: string;
  updated_at: string;
}

interface ContactSummary {
  event_id: number | null;
  follow_up_status: string;
  attributed_event_contact_id?: never; // not on event_contacts; placeholder
}

interface DealRow {
  attributed_event_contact_id: number | null;
  // varies by project; we read whatever revenue column we can find
  value_gbp?: number | null;
  amount_gbp?: number | null;
  value?: number | null;
  amount?: number | null;
}

export async function GET(req: Request) {
  const auth = await requireAuth(ROUTE, req);
  if (!auth.ok) return auth.response;

  const url = new URL(req.url);
  const includeInactive = url.searchParams.get("include_inactive") === "true";

  let q = supabase.from("events").select("*");
  if (!includeInactive) q = q.eq("active", true);
  const { data, error } = await q
    .order("start_date", { ascending: false });
  if (error) return apiError(error.message, 500);

  const events = (data ?? []) as EventRow[];

  // Per-event contact funnel + deal rollup. Fetch in 2 queries (no FK joins).
  const eventIds = events.map((e) => e.id);
  const summaries: Record<number, {
    contacts: number;
    sent: number;
    replied: number;
    bounced: number;
    deal_count: number;
    revenue_gbp: number;
    cost_gbp: number | null;
    roi_gbp: number | null;
  }> = {};
  for (const id of eventIds) {
    summaries[id] = {
      contacts: 0,
      sent: 0,
      replied: 0,
      bounced: 0,
      deal_count: 0,
      revenue_gbp: 0,
      cost_gbp: null,
      roi_gbp: null,
    };
  }

  if (eventIds.length > 0) {
    const { data: contacts } = await supabase
      .from("event_contacts")
      .select("event_id, follow_up_status, id")
      .in("event_id", eventIds);
    const contactsRows = (contacts ?? []) as Array<ContactSummary & { id: number }>;
    const contactIdToEvent = new Map<number, number>();
    for (const c of contactsRows) {
      if (!c.event_id) continue;
      contactIdToEvent.set(c.id, c.event_id);
      const s = summaries[c.event_id];
      if (!s) continue;
      s.contacts += 1;
      if (c.follow_up_status === "sent" || c.follow_up_status === "replied") s.sent += 1;
      if (c.follow_up_status === "replied") s.replied += 1;
      if (c.follow_up_status === "bounced") s.bounced += 1;
    }

    // Deals attributed to any of these contacts. Wrapped in try/catch in
    // case the deals table or attributed_event_contact_id column isn't yet
    // present in this environment.
    const contactIds = Array.from(contactIdToEvent.keys());
    if (contactIds.length > 0) {
      try {
        const { data: deals } = await supabase
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          .from("deals" as any)
          .select("attributed_event_contact_id, value_gbp, amount_gbp, value, amount")
          .in("attributed_event_contact_id", contactIds);
        for (const d of ((deals ?? []) as unknown as DealRow[])) {
          if (!d.attributed_event_contact_id) continue;
          const eventId = contactIdToEvent.get(d.attributed_event_contact_id);
          if (!eventId) continue;
          const s = summaries[eventId];
          if (!s) continue;
          s.deal_count += 1;
          const rev = d.value_gbp ?? d.amount_gbp ?? d.value ?? d.amount ?? 0;
          s.revenue_gbp += typeof rev === "number" ? rev : 0;
        }
      } catch {
        // deals table unavailable - leave deal counts at 0.
      }
    }
  }

  // Compute cost in GBP for each event (best-effort - if FX missing we leave null).
  for (const e of events) {
    try {
      const costGbp = await convertToGbp(e.cost_amount, e.cost_currency, e.start_date);
      const s = summaries[e.id];
      if (s) {
        s.cost_gbp = costGbp;
        s.roi_gbp = costGbp !== null ? s.revenue_gbp - costGbp : null;
      }
    } catch {
      // Leave null - the UI shows "FX rate missing" prompt.
    }
  }

  return apiResponse({ events, summaries });
}

export async function POST(req: Request) {
  const auth = await requireManager(ROUTE, req);
  if (!auth.ok) return auth.response;

  const body = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) return validationError(parsed.error);
  const input = parsed.data;

  const { data, error } = await supabase
    .from("events")
    .insert({
      name: input.name.trim(),
      event_type: input.event_type,
      start_date: input.start_date,
      end_date: input.end_date ?? null,
      location: input.location ?? null,
      via_network_id: input.via_network_id ?? null,
      cost_amount: input.cost_amount ?? null,
      cost_currency: input.cost_currency,
      attendees: input.attendees,
      notes: input.notes ?? null,
      context_brief: input.context_brief ?? null,
      active: true,
    })
    .select()
    .single();
  if (error) return apiError(error.message, 500);
  return apiResponse({ event: data });
}

export async function PATCH(req: Request) {
  const auth = await requireManager(ROUTE, req);
  if (!auth.ok) return auth.response;

  const body = await req.json().catch(() => null);
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) return validationError(parsed.error);
  const { id, ...updates } = parsed.data;

  const payload: Record<string, unknown> = {};
  if (updates.name !== undefined) payload.name = updates.name.trim();
  if (updates.event_type !== undefined) payload.event_type = updates.event_type;
  if (updates.start_date !== undefined) payload.start_date = updates.start_date;
  if (updates.end_date !== undefined) payload.end_date = updates.end_date;
  if (updates.location !== undefined) payload.location = updates.location;
  if (updates.via_network_id !== undefined) payload.via_network_id = updates.via_network_id;
  if (updates.cost_amount !== undefined) payload.cost_amount = updates.cost_amount;
  if (updates.cost_currency !== undefined) payload.cost_currency = updates.cost_currency;
  if (updates.attendees !== undefined) payload.attendees = updates.attendees;
  if (updates.notes !== undefined) payload.notes = updates.notes;
  if (updates.context_brief !== undefined) payload.context_brief = updates.context_brief;
  if (updates.active !== undefined) payload.active = updates.active;
  if (Object.keys(payload).length === 0) return apiError("No fields to update", 400);

  const { data, error } = await supabase
    .from("events")
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .update(payload as any)
    .eq("id", id)
    .select()
    .single();
  if (error) return apiError(error.message, 500);
  return apiResponse({ event: data });
}

export async function DELETE(req: Request) {
  const auth = await requireManager(ROUTE, req);
  if (!auth.ok) return auth.response;

  const url = new URL(req.url);
  const id = parseInt(url.searchParams.get("id") || "0", 10);
  if (!id) return apiError("id required", 400);

  // Soft delete - keep event_contacts rows pointed at it for ROI history.
  const { error } = await supabase
    .from("events")
    .update({ active: false })
    .eq("id", id);
  if (error) return apiError(error.message, 500);
  return apiResponse({ success: true });
}
