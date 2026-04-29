import { supabase } from "@/services/base";
import { getSession } from "@/lib/session";
import { apiError, apiResponse } from "@/lib/validation";
import { z } from "zod";

/**
 * CRUD for the freight_networks directory. Reads are open to authenticated
 * users (used by the email page's network detection too); writes are
 * manager / super_admin only - same access pattern as reply_rules.
 */

const RELATIONSHIP = ["member", "non-member", "prospect", "declined"] as const;
const NETWORK_TYPE = ["general", "project_cargo", "specialised", "association"] as const;
const CURRENCIES = ["GBP", "USD", "EUR"] as const;

const createSchema = z.object({
  name: z.string().min(1).max(120),
  primary_domain: z.string().min(3).max(255),
  additional_domains: z.array(z.string().min(3).max(255)).max(10).default([]),
  relationship: z.enum(RELATIONSHIP).default("non-member"),
  network_type: z.enum(NETWORK_TYPE).default("general"),
  // Renamed from annual_fee_gbp in migration 059. annual_fee_amount is in
  // fee_currency (default GBP). NULL on sub-networks means "covered by parent".
  annual_fee_amount: z.number().nonnegative().max(1_000_000).nullable().optional(),
  fee_currency: z.enum(CURRENCIES).default("GBP"),
  events_per_year: z.number().int().nonnegative().max(50).nullable().optional(),
  website: z.string().max(255).nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
  parent_network_id: z.number().int().positive().nullable().optional(),
  active: z.boolean().default(true),
});

const updateSchema = createSchema.partial().extend({
  id: z.number().int().positive(),
});

async function isManager(email: string): Promise<boolean> {
  const { data } = await supabase
    .from("staff")
    .select("is_manager")
    .eq("email", email.toLowerCase())
    .maybeSingle();
  return Boolean((data as { is_manager?: boolean } | null)?.is_manager);
}

function normaliseDomain(value: string): string {
  return value.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/$/, "");
}

export async function GET() {
  const session = await getSession();
  if (!session?.email) return apiError("Not authenticated", 401);

  const { data, error } = await supabase
    .from("freight_networks")
    .select("*")
    .order("name", { ascending: true });
  if (error) return apiError(error.message, 500);
  return apiResponse({ networks: data ?? [] });
}

export async function POST(req: Request) {
  const session = await getSession();
  if (!session?.email) return apiError("Not authenticated", 401);
  if (session.role !== "super_admin" && !(await isManager(session.email))) {
    return apiError("Forbidden", 403);
  }

  const body = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return apiError(
      `Validation failed: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join(", ")}`,
      400,
    );
  }
  const input = parsed.data;

  const { data, error } = await supabase
    .from("freight_networks")
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .insert({
      name: input.name.trim(),
      primary_domain: normaliseDomain(input.primary_domain),
      additional_domains: input.additional_domains.map(normaliseDomain),
      relationship: input.relationship,
      network_type: input.network_type,
      annual_fee_amount: input.annual_fee_amount ?? null,
      fee_currency: input.fee_currency,
      events_per_year: input.events_per_year ?? null,
      website: input.website ?? null,
      notes: input.notes ?? null,
      parent_network_id: input.parent_network_id ?? null,
      active: input.active,
    } as any)
    .select()
    .single();
  if (error) return apiError(error.message, 500);
  return apiResponse({ network: data });
}

export async function PATCH(req: Request) {
  const session = await getSession();
  if (!session?.email) return apiError("Not authenticated", 401);
  if (session.role !== "super_admin" && !(await isManager(session.email))) {
    return apiError("Forbidden", 403);
  }

  const body = await req.json().catch(() => null);
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) {
    return apiError(
      `Validation failed: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join(", ")}`,
      400,
    );
  }
  const { id, ...updates } = parsed.data;

  const payload: Record<string, unknown> = {};
  if (updates.name !== undefined) payload.name = updates.name.trim();
  if (updates.primary_domain !== undefined) payload.primary_domain = normaliseDomain(updates.primary_domain);
  if (updates.additional_domains !== undefined) payload.additional_domains = updates.additional_domains.map(normaliseDomain);
  if (updates.relationship !== undefined) payload.relationship = updates.relationship;
  if (updates.network_type !== undefined) payload.network_type = updates.network_type;
  if (updates.annual_fee_amount !== undefined) payload.annual_fee_amount = updates.annual_fee_amount;
  if (updates.fee_currency !== undefined) payload.fee_currency = updates.fee_currency;
  if (updates.events_per_year !== undefined) payload.events_per_year = updates.events_per_year;
  if (updates.website !== undefined) payload.website = updates.website;
  if (updates.notes !== undefined) payload.notes = updates.notes;
  if (updates.parent_network_id !== undefined) payload.parent_network_id = updates.parent_network_id;
  if (updates.active !== undefined) payload.active = updates.active;

  const { data, error } = await supabase
    .from("freight_networks")
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .update(payload as any)
    .eq("id", id)
    .select()
    .single();
  if (error) return apiError(error.message, 500);
  return apiResponse({ network: data });
}

export async function DELETE(req: Request) {
  const session = await getSession();
  if (!session?.email) return apiError("Not authenticated", 401);
  if (session.role !== "super_admin" && !(await isManager(session.email))) {
    return apiError("Forbidden", 403);
  }
  const url = new URL(req.url);
  const id = parseInt(url.searchParams.get("id") || "0");
  if (!id) return apiError("id required", 400);
  const { error } = await supabase.from("freight_networks").delete().eq("id", id);
  if (error) return apiError(error.message, 500);
  return apiResponse({ success: true });
}
