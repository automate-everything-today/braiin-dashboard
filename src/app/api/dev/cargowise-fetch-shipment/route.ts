/**
 * Manual eAdaptor shipment query test.
 *
 * POST /api/dev/cargowise-fetch-shipment
 *   { dataTargetType: 'ForwardingShipment' | 'ForwardingConsol' | 'CustomsDeclaration',
 *     key: '<job number>' }
 *
 * Manager / super_admin only. Rate-limited. Calls the cargowise
 * adapter's fetchShipment via eAdaptor HTTP+XML and returns the
 * canonical TmsShipment shape (or 404 / 502 on failure).
 *
 * Every call writes a row to tms.outbound_calls. Auth failures are
 * surfaced as 401 to the caller and logged loudly.
 */

import { supabase } from "@/services/base";
import { getSession } from "@/lib/session";
import { apiError, apiResponse } from "@/lib/validation";
import { TENANT_ZERO_ORG_ID } from "@/lib/activity/log-event";
import { checkRateLimit } from "@/lib/rate-limit";
import { cargowiseAdapter } from "@/lib/tms/cargowise";
import { TmsAdapterError, TmsAuthError } from "@/lib/tms/adapter";
import { fetchShipmentByKey } from "@/lib/tms/cargowise/edaptor/queries";
import type { TmsConnection } from "@/lib/tms/types";

const VALID_TARGETS = new Set(["ForwardingShipment", "ForwardingConsol", "CustomsDeclaration"]);

interface ConnectionRow {
  connection_id: string;
  provider_id: string;
  name: string;
  auth_method: string;
  secrets_ref: Record<string, string>;
  config: Record<string, unknown>;
  enabled: boolean;
}

async function isManager(email: string): Promise<boolean> {
  const { data } = await supabase
    .from("staff")
    .select("is_manager")
    .eq("email", email.toLowerCase())
    .maybeSingle();
  return Boolean((data as { is_manager?: boolean } | null)?.is_manager);
}

export async function POST(req: Request) {
  const session = await getSession();
  if (!session?.email) return apiError("Not authenticated", 401);
  if (session.role !== "super_admin" && !(await isManager(session.email))) {
    return apiError("Forbidden", 403);
  }
  if (!(await checkRateLimit(`cargowise-fetch:${session.email.toLowerCase()}`, 30))) {
    return apiError("Too many requests. Please slow down.", 429);
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return apiError("Invalid JSON body", 400);
  }

  const dataTargetType = typeof body.dataTargetType === "string" ? body.dataTargetType.trim() : "";
  const key = typeof body.key === "string" ? body.key.trim() : "";

  if (!VALID_TARGETS.has(dataTargetType)) {
    return apiError(
      `dataTargetType must be one of: ${Array.from(VALID_TARGETS).join(", ")}`,
      400,
    );
  }
  if (!key) return apiError("key is required (e.g. job number 'AS123456')", 400);
  if (key.length > 50) return apiError("key too long", 400);

  // Resolve a connection. Default to env-default synthetic connection
  // when none configured, so the smoke test works before we have a
  // tms.connections row written.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tmsAny = (supabase as any).schema("tms");
  const { data: connRow } = (await tmsAny
    .from("connections")
    .select("connection_id,provider_id,name,auth_method,secrets_ref,config,enabled")
    .eq("org_id", TENANT_ZERO_ORG_ID)
    .eq("provider_id", "cargowise")
    .eq("enabled", true)
    .maybeSingle()) as { data: ConnectionRow | null };

  const connection: TmsConnection = connRow
    ? {
        connectionId: connRow.connection_id,
        orgId: TENANT_ZERO_ORG_ID,
        providerId: connRow.provider_id,
        name: connRow.name,
        authMethod: connRow.auth_method,
        secretsRef: connRow.secrets_ref ?? {},
        config: connRow.config ?? {},
        enabled: connRow.enabled,
      }
    : {
        connectionId: "synthetic",
        orgId: TENANT_ZERO_ORG_ID,
        providerId: "cargowise",
        name: "env-default",
        authMethod: "edaptor_http",
        secretsRef: {},
        config: {},
        enabled: true,
      };

  try {
    const shipment = await fetchShipmentByKey(connection, {
      dataTargetType,
      key,
      requestedBy: session.email.toLowerCase(),
    });
    if (!shipment) {
      return apiError("Not found in CargoWise (Entity Not Found)", 404);
    }
    return apiResponse({ shipment });
  } catch (err) {
    if (err instanceof TmsAuthError) {
      return apiError(`Auth failed: ${err.message}`, 401);
    }
    if (err instanceof TmsAdapterError) {
      return apiError(err.message, 502);
    }
    console.error("[cargowise-fetch] unexpected:", err);
    return apiError("Fetch failed", 500);
  }
}

// Avoid unused-import warning on cargowiseAdapter when this route only
// calls the lower-level helper directly. Keeping the import documents
// that this endpoint exercises the cargowise adapter surface.
void cargowiseAdapter;
