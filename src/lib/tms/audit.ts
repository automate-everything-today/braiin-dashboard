/**
 * Audit log writer for outbound TMS calls.
 *
 * Every call to a TMS (Cargowise eAdaptor, Cargo Visibility, future
 * Magaya etc) writes a row to tms.outbound_calls with operation,
 * requestor, status, and timing. Credentials and full payload bodies
 * are NEVER written.
 *
 * Auth failures get a partial index in the migration so monitoring can
 * alert on them.
 */

import { supabase } from "@/services/base";

export type OutboundStatus =
  | "success"
  | "auth_error"
  | "http_error"
  | "parse_error"
  | "timeout"
  | "unsupported";

export interface OutboundCallRecord {
  orgId: string;
  connectionId?: string | null;
  providerId: string;
  operation: string;
  requestedBy: string;
  /** Free-form short string. NEVER include credentials. */
  requestSummary?: string;
  requestedAt: Date;
  completedAt: Date;
  durationMs: number;
  status: OutboundStatus;
  httpStatus?: number | null;
  errorCode?: string | null;
  errorMessage?: string | null;
  bytesSent?: number | null;
  bytesReceived?: number | null;
  metadata?: Record<string, unknown>;
}

interface AuditClient {
  from(table: string): {
    insert: (row: Record<string, unknown>) => Promise<{ error: { message: string } | null }>;
  };
}

function tmsClient(): AuditClient {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (supabase as any).schema("tms") as AuditClient;
}

/**
 * Persist an outbound-call audit row. Never throws - audit failures
 * are logged but must not block the user-facing call path.
 */
export async function logOutboundCall(record: OutboundCallRecord): Promise<void> {
  try {
    const row = {
      org_id: record.orgId,
      connection_id: record.connectionId ?? null,
      provider_id: record.providerId,
      operation: record.operation,
      requested_by: record.requestedBy,
      request_summary: record.requestSummary ?? null,
      requested_at: record.requestedAt.toISOString(),
      completed_at: record.completedAt.toISOString(),
      duration_ms: record.durationMs,
      status: record.status,
      http_status: record.httpStatus ?? null,
      error_code: record.errorCode ?? null,
      error_message: record.errorMessage ? record.errorMessage.slice(0, 1000) : null,
      bytes_sent: record.bytesSent ?? null,
      bytes_received: record.bytesReceived ?? null,
      metadata: record.metadata ?? {},
    };
    const { error } = await tmsClient().from("outbound_calls").insert(row);
    if (error) {
      console.warn("[tms/audit] outbound_calls insert failed:", error.message);
    }
  } catch (err) {
    console.warn(
      "[tms/audit] threw:",
      err instanceof Error ? err.message : String(err),
    );
  }
}
