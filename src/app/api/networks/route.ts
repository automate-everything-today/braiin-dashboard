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

const createSchema = z.object({
  name: z.string().min(1).max(120),
  primary_domain: z.string().min(3).max(255),
  additional_domains: z.array(z.string().min(3).max(255)).max(10).default([]),
  relationship: z.enum(RELATIONSHIP).default("non-member"),
  network_type: z.enum(NETWORK_TYPE).default("general"),
  annual_fee_gbp: z.number().int().nonnegative().max(1_000_000).nullable().optional(),
  events_per_year: z.number().int().nonnegative().max(50).nullable().optional(),
  website: z.string().max(255).nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
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
    .insert({
      name: input.name.trim(),
      primary_domain: normaliseDomain(input.primary_domain),
      additional_domains: input.additional_domains.map(normaliseDomain),
      relationship: input.relationship,
      network_type: input.network_type,
      annual_fee_gbp: input.annual_fee_gbp ?? null,
      events_per_year: input.events_per_year ?? null,
      website: input.website ?? null,
      notes: input.notes ?? null,
      active: input.active,
    })
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

  const payload: {
    name?: string;
    primary_domain?: string;
    additional_domains?: string[];
    relationship?: "member" | "non-member" | "prospect" | "declined";
    network_type?: "general" | "project_cargo" | "specialised" | "association";
    annual_fee_gbp?: number | null;
    events_per_year?: number | null;
    website?: string | null;
    notes?: string | null;
    active?: boolean;
  } = {};
  if (updates.name !== undefined) payload.name = updates.name.trim();
  if (updates.primary_domain !== undefined) payload.primary_domain = normaliseDomain(updates.primary_domain);
  if (updates.additional_domains !== undefined) payload.additional_domains = updates.additional_domains.map(normaliseDomain);
  if (updates.relationship !== undefined) payload.relationship = updates.relationship;
  if (updates.network_type !== undefined) payload.network_type = updates.network_type;
  if (updates.annual_fee_gbp !== undefined) payload.annual_fee_gbp = updates.annual_fee_gbp;
  if (updates.events_per_year !== undefined) payload.events_per_year = updates.events_per_year;
  if (updates.website !== undefined) payload.website = updates.website;
  if (updates.notes !== undefined) payload.notes = updates.notes;
  if (updates.active !== undefined) payload.active = updates.active;

  const { data, error } = await supabase
    .from("freight_networks")
    .update(payload)
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
