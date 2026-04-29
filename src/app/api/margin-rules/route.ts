// CRUD for quotes.margin_rules.

import { z } from "zod";
import { supabase } from "@/services/base";
import { requireAuth, requireManager } from "@/lib/api-auth";
import { getOrgId } from "@/lib/org";

const ROUTE = "/api/margin-rules";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as unknown as { schema: (s: string) => any };

const ruleSchema = z.object({
  ruleId: z.string().max(64).optional().default(""),
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  customerName: z.string().max(200).optional(),
  carrierName: z.string().max(200).optional(),
  mode: z.string().max(32).optional(),
  direction: z.string().max(32).optional(),
  originCountry: z.string().max(8).optional(),
  destinationCountry: z.string().max(8).optional(),
  macroGroup: z.string().max(64).optional(),
  chargeCode: z.string().max(64).optional(),
  markupMethod: z.string().min(1).max(32),
  markupValue: z.number().min(-1_000_000).max(1_000_000),
  markupCurrency: z.string().min(3).max(3),
  currencyRates: z.record(z.string(), z.number()).optional(),
  minChargeAmount: z.number().min(0).max(1_000_000).optional(),
  minChargeCurrency: z.string().min(3).max(3).optional(),
  isActive: z.boolean().default(true),
});

type RuleApi = z.infer<typeof ruleSchema>;

function rowToApi(r: Record<string, unknown>): RuleApi {
  return {
    ruleId: String(r.rule_id),
    name: String(r.name),
    description: (r.description as string | null) ?? undefined,
    customerName: undefined,
    carrierName: undefined,
    mode: (r.mode as string | null) ?? undefined,
    direction: (r.direction as string | null) ?? undefined,
    originCountry: (r.origin_country as string | null) ?? undefined,
    destinationCountry: (r.destination_country as string | null) ?? undefined,
    macroGroup: (r.macro_group as string | null) ?? undefined,
    chargeCode: (r.charge_code as string | null) ?? undefined,
    markupMethod: String(r.markup_method),
    markupValue: Number(r.markup_value ?? 0),
    markupCurrency: String(r.markup_currency ?? "GBP"),
    currencyRates: (r.currency_rates as Record<string, number> | null) ?? undefined,
    minChargeAmount: r.min_charge_amount != null ? Number(r.min_charge_amount) : undefined,
    minChargeCurrency: (r.min_charge_currency as string | null) ?? undefined,
    isActive: r.is_active !== false,
  };
}

function apiToRow(b: RuleApi) {
  return {
    rule_id: b.ruleId || undefined,
    org_id: getOrgId(),
    name: b.name,
    description: b.description ?? null,
    mode: b.mode ?? null,
    direction: b.direction ?? null,
    origin_country: b.originCountry ?? null,
    destination_country: b.destinationCountry ?? null,
    macro_group: b.macroGroup ?? null,
    charge_code: b.chargeCode ?? null,
    markup_method: b.markupMethod,
    markup_value: b.markupValue,
    markup_currency: b.markupCurrency,
    currency_rates: b.currencyRates ?? null,
    min_charge_amount: b.minChargeAmount ?? null,
    min_charge_currency: b.minChargeCurrency ?? null,
    is_active: b.isActive,
  };
}

export async function GET() {
  const auth = await requireAuth(ROUTE);
  if (!auth.ok) return auth.response;

  const { data, error } = await db
    .schema("quotes")
    .from("margin_rules")
    .select("*")
    .eq("org_id", getOrgId())
    .order("rule_priority", { ascending: false });
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({
    rules: ((data ?? []) as Array<Record<string, unknown>>).map(rowToApi),
  });
}

export async function POST(req: Request) {
  const auth = await requireManager(ROUTE);
  if (!auth.ok) return auth.response;

  const parsed = ruleSchema.safeParse(await req.json());
  if (!parsed.success) {
    return Response.json({ error: "Invalid input", issues: parsed.error.issues }, { status: 400 });
  }
  const row = apiToRow(parsed.data);
  const { data, error } = await db
    .schema("quotes")
    .from("margin_rules")
    .upsert(row, { onConflict: "rule_id" })
    .select()
    .single();
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ rule: rowToApi(data as Record<string, unknown>) });
}

const bulkSchema = z.object({ rules: z.array(ruleSchema).min(1).max(2000) });

export async function PATCH(req: Request) {
  const auth = await requireManager(ROUTE);
  if (!auth.ok) return auth.response;

  const parsed = bulkSchema.safeParse(await req.json());
  if (!parsed.success) {
    return Response.json({ error: "Invalid input", issues: parsed.error.issues }, { status: 400 });
  }
  const rows = parsed.data.rules.map(apiToRow);
  const { error } = await db
    .schema("quotes")
    .from("margin_rules")
    .upsert(rows, { onConflict: "rule_id" });
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ success: true, imported: parsed.data.rules.length });
}

const deleteSchema = z.object({ ruleId: z.string().min(1).max(64) });

export async function DELETE(req: Request) {
  const auth = await requireManager(ROUTE);
  if (!auth.ok) return auth.response;

  const parsed = deleteSchema.safeParse(await req.json());
  if (!parsed.success) {
    return Response.json({ error: "ruleId required" }, { status: 400 });
  }
  const { error } = await db
    .schema("quotes")
    .from("margin_rules")
    .delete()
    .eq("rule_id", parsed.data.ruleId)
    .eq("org_id", getOrgId());
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ success: true });
}
