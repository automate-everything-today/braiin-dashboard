/**
 * Manual Cargo Visibility subscription test.
 *
 * POST /api/dev/cargowise-subscribe
 *   { tmsRef, tmsRefType: "mbol" | "awb",
 *     carrierCode, transportMode?: "SEA" | "AIR",
 *     containerMode?: "FCL" | "LCL",
 *     originUnloco?, destinationUnloco?,
 *     vesselName?, voyageNumber?, eta?, etd? }
 *
 * Persists a `tms.subscriptions` row first (status=pending), then
 * calls cargowiseAdapter.createSubscription(). Updates the row with
 * acknowledged / rejected status based on the IRA / IRJ response.
 *
 * Manager / super_admin only. The smoke-test page calls this to
 * verify the SBR -> IRA happy path end to end.
 */

import { randomUUID } from "node:crypto";
import { supabase } from "@/services/base";
import { getSession } from "@/lib/session";
import { apiError, apiResponse } from "@/lib/validation";
import { TENANT_ZERO_ORG_ID } from "@/lib/activity/log-event";
import { checkRateLimit } from "@/lib/rate-limit";
import { cargowiseAdapter } from "@/lib/tms/cargowise";
import type { TmsConnection, TmsSubscriptionRequest } from "@/lib/tms/types";

const VALID_REF_TYPES = new Set(["mbol", "awb", "container", "booking"]);
const VALID_TRANSPORT = new Set(["SEA", "AIR"]);
const VALID_CONTAINER = new Set(["FCL", "LCL"]);

interface ConnectionRow {
  connection_id: string;
  provider_id: string;
  name: string;
  auth_method: string;
  secrets_ref: Record<string, string>;
  config: Record<string, unknown>;
  enabled: boolean;
}

interface SubscriptionInsert {
  org_id: string;
  connection_id: string | null;
  provider_id: string;
  tms_ref: string;
  tms_ref_type: string;
  carrier_code: string | null;
  transport_mode: string | null;
  container_mode: string | null;
  client_reference: string;
  request_payload: string | null;
  request_format: string;
  status: string;
  acknowledged_at: string | null;
  rejected_at: string | null;
  rejection_reason: string | null;
  created_by: string;
  metadata: Record<string, unknown>;
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
  if (!(await checkRateLimit(`cargowise-subscribe:${session.email.toLowerCase()}`, 30))) {
    return apiError("Too many requests. Please slow down.", 429);
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return apiError("Invalid JSON body", 400);
  }

  const tmsRef = typeof body.tmsRef === "string" ? body.tmsRef.trim() : "";
  const tmsRefType = typeof body.tmsRefType === "string" ? body.tmsRefType.trim() : "";
  if (!tmsRef) return apiError("tmsRef is required", 400);
  if (!VALID_REF_TYPES.has(tmsRefType)) {
    return apiError("tmsRefType must be one of: mbol, awb, container, booking", 400);
  }

  const carrierCode = typeof body.carrierCode === "string" ? body.carrierCode.trim().toUpperCase() : undefined;
  const transportMode = typeof body.transportMode === "string" ? body.transportMode.trim().toUpperCase() : undefined;
  if (transportMode && !VALID_TRANSPORT.has(transportMode)) {
    return apiError("transportMode must be SEA or AIR", 400);
  }
  const containerMode = typeof body.containerMode === "string" ? body.containerMode.trim().toUpperCase() : undefined;
  if (containerMode && !VALID_CONTAINER.has(containerMode)) {
    return apiError("containerMode must be FCL or LCL", 400);
  }

  // Resolve a connection for this org+provider (or fall back to a
  // synthetic env-default connection if none configured yet).
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
        authMethod: "cv_s2s_jwt",
        secretsRef: {},
        config: {},
        enabled: true,
      };

  // Build the canonical subscription request
  const subRequest: TmsSubscriptionRequest = {
    tmsRef,
    tmsRefType: tmsRefType as TmsSubscriptionRequest["tmsRefType"],
    carrierCode,
    transportMode: transportMode as TmsSubscriptionRequest["transportMode"],
    containerMode: containerMode as TmsSubscriptionRequest["containerMode"],
    origin: typeof body.originUnloco === "string"
      ? { unlocode: body.originUnloco.trim().toUpperCase() }
      : undefined,
    destination: typeof body.destinationUnloco === "string"
      ? { unlocode: body.destinationUnloco.trim().toUpperCase() }
      : undefined,
    vesselName: typeof body.vesselName === "string" ? body.vesselName.trim() : undefined,
    voyageNumber: typeof body.voyageNumber === "string" ? body.voyageNumber.trim() : undefined,
    eta: typeof body.eta === "string" && body.eta ? new Date(body.eta) : undefined,
    etd: typeof body.etd === "string" && body.etd ? new Date(body.etd) : undefined,
  };

  const clientReference = randomUUID();
  subRequest.clientReference = clientReference;

  // Build the callback URL that CV will POST events to.
  const requestUrl = new URL(req.url);
  const callbackUrl = `${requestUrl.protocol}//${requestUrl.host}/api/inbound/cargowise-events`;

  // Persist a pending row first - always visible in the dashboard
  // even if the call fails.
  const insertRow: SubscriptionInsert = {
    org_id: TENANT_ZERO_ORG_ID,
    connection_id: connRow ? connRow.connection_id : null,
    provider_id: "cargowise",
    tms_ref: tmsRef,
    tms_ref_type: tmsRefType,
    carrier_code: carrierCode ?? null,
    transport_mode: transportMode ?? null,
    container_mode: containerMode ?? null,
    client_reference: clientReference,
    request_payload: null,
    request_format: "xml",
    status: "pending",
    acknowledged_at: null,
    rejected_at: null,
    rejection_reason: null,
    created_by: session.email.toLowerCase(),
    metadata: { callback_url: callbackUrl },
  };

  const { data: inserted, error: insertErr } = await tmsAny
    .from("subscriptions")
    .insert(insertRow)
    .select("subscription_id")
    .single();

  if (insertErr || !inserted) {
    console.error("[cargowise-subscribe] persist failed:", insertErr?.message);
    return apiError("Failed to persist subscription", 500);
  }
  const subscriptionId = (inserted as { subscription_id: string }).subscription_id;

  // Make the live call
  let result;
  try {
    result = await cargowiseAdapter.createSubscription(connection, subRequest, callbackUrl);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await tmsAny
      .from("subscriptions")
      .update({
        status: "rejected",
        rejected_at: new Date().toISOString(),
        rejection_reason: msg.slice(0, 500),
      })
      .eq("subscription_id", subscriptionId);
    return apiError(`Subscription call failed: ${msg}`, 502);
  }

  // Update the row with the result
  const updates: Partial<SubscriptionInsert> = { status: result.status };
  if (result.status === "acknowledged") updates.acknowledged_at = new Date().toISOString();
  if (result.status === "rejected") {
    updates.rejected_at = new Date().toISOString();
    updates.rejection_reason = result.rejectionReason ?? null;
  }
  await tmsAny.from("subscriptions").update(updates).eq("subscription_id", subscriptionId);

  return apiResponse({
    subscriptionId,
    clientReference,
    status: result.status,
    rejectionReason: result.rejectionReason ?? null,
  });
}
