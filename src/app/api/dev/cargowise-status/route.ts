/**
 * Cargowise health check for the smoke-test page.
 *
 * GET /api/dev/cargowise-status
 *
 * Resolves env-based secrets and runs the cargowise adapter's
 * healthCheck (which signs a JWT and exchanges it with the WiseTech
 * IdP). Returns ok:true if the round trip succeeds.
 *
 * Auth: cookie session via the global proxy. Manager / super_admin
 * only since the response leaks auth-state hints.
 */

import { supabase } from "@/services/base";
import { getSession } from "@/lib/session";
import { apiError, apiResponse } from "@/lib/validation";
import { cargowiseAdapter } from "@/lib/tms/cargowise";
import type { TmsConnection } from "@/lib/tms/types";

async function isManager(email: string): Promise<boolean> {
  const { data } = await supabase
    .from("staff")
    .select("is_manager")
    .eq("email", email.toLowerCase())
    .maybeSingle();
  return Boolean((data as { is_manager?: boolean } | null)?.is_manager);
}

export async function GET() {
  const session = await getSession();
  if (!session?.email) return apiError("Not authenticated", 401);
  if (session.role !== "super_admin" && !(await isManager(session.email))) {
    return apiError("Forbidden", 403);
  }

  // Synthetic connection that points the adapter at the standard env vars.
  // Real per-org connections will live in tms.connections; this endpoint
  // is just a smoke-test for the auth chain.
  const connection: TmsConnection = {
    connectionId: "synthetic",
    orgId: "00000000-0000-0000-0000-000000000001",
    providerId: "cargowise",
    name: "env-default",
    authMethod: "cv_s2s_jwt",
    secretsRef: {},
    config: {},
    enabled: true,
  };

  try {
    const result = await cargowiseAdapter.healthCheck(connection);
    return apiResponse(result);
  } catch (err) {
    return apiResponse({
      ok: false,
      message: err instanceof Error ? err.message : String(err),
    });
  }
}
