// CRUD for quotes.charge_codes (canonical Braiin dictionary) +
// the corresponding tms.charge_code_map row when tms_origin === 'cargowise'.

import { supabase } from "@/services/base";

// Cross-schema shim: the generated Database type only knows the public
// schema. Cast to a minimal shape that lets us hit other schemas.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as unknown as { schema: (s: string) => any };

interface ChargeCodeRow {
  braiinCode: string;
  description: string;
  billingType: "margin" | "revenue" | "disbursement";
  macroGroup: "origin_exw" | "freight" | "destination_delivery" | "insurance_other";
  defaultMarginPct: number;
  applicableModes: string[];
  applicableDirections: string[];
  tmsOrigin: "cargowise" | "magaya" | "descartes" | "native";
  cwCode: string;
  cwDepartments: string[];
}

function rowToApi(
  r: Record<string, unknown>,
  mapping?: { tms_code?: string; tms_metadata?: { departments?: string[] } },
): ChargeCodeRow {
  const meta = mapping?.tms_metadata ?? {};
  return {
    braiinCode: String(r.braiin_code),
    description: String(r.description),
    billingType: r.billing_type as ChargeCodeRow["billingType"],
    macroGroup: r.macro_group as ChargeCodeRow["macroGroup"],
    defaultMarginPct: Number(r.default_margin_pct ?? 0),
    applicableModes: (r.applicable_modes as string[]) ?? [],
    applicableDirections: (r.applicable_directions as string[]) ?? [],
    tmsOrigin: (r.tms_origin as ChargeCodeRow["tmsOrigin"]) ?? "native",
    cwCode: mapping?.tms_code ?? "",
    cwDepartments: meta.departments ?? [],
  };
}

export async function GET() {
  const { data: codes, error: e1 } = await db
    .schema("quotes")
    .from("charge_codes")
    .select("*")
    .order("braiin_code");
  if (e1) return Response.json({ error: e1.message }, { status: 500 });

  const { data: maps } = await db
    .schema("tms")
    .from("charge_code_map")
    .select("*")
    .eq("provider_id", "cargowise");

  const mapByBraiin = new Map<
    string,
    { tms_code: string; tms_metadata: { departments?: string[] } }
  >();
  for (const m of (maps ?? []) as Array<{
    braiin_code: string;
    tms_code: string;
    tms_metadata: { departments?: string[] };
  }>) {
    mapByBraiin.set(m.braiin_code, {
      tms_code: m.tms_code,
      tms_metadata: m.tms_metadata ?? {},
    });
  }

  const rows = ((codes ?? []) as Array<Record<string, unknown>>).map((c) =>
    rowToApi(c, mapByBraiin.get(String(c.braiin_code))),
  );
  return Response.json({ codes: rows });
}

export async function POST(req: Request) {
  const body = (await req.json()) as ChargeCodeRow;
  if (!body.braiinCode || !body.description) {
    return Response.json({ error: "braiinCode + description required" }, { status: 400 });
  }
  const { error: e1 } = await db
    .schema("quotes")
    .from("charge_codes")
    .upsert(
      {
        braiin_code: body.braiinCode,
        description: body.description,
        billing_type: body.billingType,
        macro_group: body.macroGroup,
        default_margin_pct: body.defaultMarginPct,
        applicable_modes: body.applicableModes,
        applicable_directions: body.applicableDirections,
        tms_origin: body.tmsOrigin,
        is_active: true,
      },
      { onConflict: "braiin_code" },
    );
  if (e1) return Response.json({ error: e1.message }, { status: 500 });

  if (body.tmsOrigin === "cargowise" && body.cwCode) {
    const { error: e2 } = await db
      .schema("tms")
      .from("charge_code_map")
      .upsert(
        {
          provider_id: "cargowise",
          tms_code: body.cwCode,
          braiin_code: body.braiinCode,
          tms_description: body.description,
          tms_metadata: { departments: body.cwDepartments },
          is_active: true,
        },
        { onConflict: "provider_id,tms_code" },
      );
    if (e2) return Response.json({ error: e2.message }, { status: 500 });
  }

  return Response.json({ success: true });
}

// Bulk upsert for CSV imports.
export async function PATCH(req: Request) {
  const { rows } = (await req.json()) as { rows: ChargeCodeRow[] };
  if (!Array.isArray(rows) || rows.length === 0) {
    return Response.json({ error: "rows[] required" }, { status: 400 });
  }
  const codeRows = rows.map((b) => ({
    braiin_code: b.braiinCode,
    description: b.description,
    billing_type: b.billingType,
    macro_group: b.macroGroup,
    default_margin_pct: b.defaultMarginPct,
    applicable_modes: b.applicableModes,
    applicable_directions: b.applicableDirections,
    tms_origin: b.tmsOrigin,
    is_active: true,
  }));
  const { error: e1 } = await db
    .schema("quotes")
    .from("charge_codes")
    .upsert(codeRows, { onConflict: "braiin_code" });
  if (e1) return Response.json({ error: e1.message }, { status: 500 });

  const mapRows = rows
    .filter((b) => b.tmsOrigin === "cargowise" && b.cwCode)
    .map((b) => ({
      provider_id: "cargowise",
      tms_code: b.cwCode,
      braiin_code: b.braiinCode,
      tms_description: b.description,
      tms_metadata: { departments: b.cwDepartments },
      is_active: true,
    }));
  if (mapRows.length > 0) {
    const { error: e2 } = await db
      .schema("tms")
      .from("charge_code_map")
      .upsert(mapRows, { onConflict: "provider_id,tms_code" });
    if (e2) return Response.json({ error: e2.message }, { status: 500 });
  }

  return Response.json({ success: true, imported: rows.length });
}

export async function DELETE(req: Request) {
  const { braiinCode } = await req.json();
  if (!braiinCode) return Response.json({ error: "braiinCode required" }, { status: 400 });
  await db
    .schema("tms")
    .from("charge_code_map")
    .delete()
    .eq("braiin_code", braiinCode);
  const { error } = await db
    .schema("quotes")
    .from("charge_codes")
    .delete()
    .eq("braiin_code", braiinCode);
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ success: true });
}
