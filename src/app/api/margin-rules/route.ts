// CRUD for quotes.margin_rules.

import { supabase } from "@/services/base";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as unknown as { schema: (s: string) => any };

const ORG_ID =
  process.env.DEFAULT_ORG_ID ??
  process.env.NEXT_PUBLIC_DEFAULT_ORG_ID ??
  "00000000-0000-0000-0000-000000000001";

interface RuleApi {
  ruleId: string;
  name: string;
  description?: string;
  customerName?: string;
  carrierName?: string;
  mode?: string;
  direction?: string;
  originCountry?: string;
  destinationCountry?: string;
  macroGroup?: string;
  chargeCode?: string;
  markupMethod: string;
  markupValue: number;
  markupCurrency: string;
  currencyRates?: Record<string, number>;
  minChargeAmount?: number;
  minChargeCurrency?: string;
  isActive: boolean;
}

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
    org_id: ORG_ID,
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
  const { data, error } = await db
    .schema("quotes")
    .from("margin_rules")
    .select("*")
    .eq("org_id", ORG_ID)
    .order("rule_priority", { ascending: false });
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({
    rules: ((data ?? []) as Array<Record<string, unknown>>).map(rowToApi),
  });
}

export async function POST(req: Request) {
  const body = (await req.json()) as RuleApi;
  if (!body.name || !body.markupMethod) {
    return Response.json({ error: "name + markupMethod required" }, { status: 400 });
  }
  const row = apiToRow(body);
  const { data, error } = await db
    .schema("quotes")
    .from("margin_rules")
    .upsert(row, { onConflict: "rule_id" })
    .select()
    .single();
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ rule: rowToApi(data as Record<string, unknown>) });
}

export async function PATCH(req: Request) {
  const { rules } = (await req.json()) as { rules: RuleApi[] };
  if (!Array.isArray(rules) || rules.length === 0) {
    return Response.json({ error: "rules[] required" }, { status: 400 });
  }
  const rows = rules.map(apiToRow);
  const { error } = await db
    .schema("quotes")
    .from("margin_rules")
    .upsert(rows, { onConflict: "rule_id" });
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ success: true, imported: rules.length });
}

export async function DELETE(req: Request) {
  const { ruleId } = await req.json();
  if (!ruleId) return Response.json({ error: "ruleId required" }, { status: 400 });
  const { error } = await db
    .schema("quotes")
    .from("margin_rules")
    .delete()
    .eq("rule_id", ruleId)
    .eq("org_id", ORG_ID);
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ success: true });
}
