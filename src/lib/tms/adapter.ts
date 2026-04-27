/**
 * The interface every TMS adapter implements.
 *
 * Adapters are stateless. Per-call connection config is passed in;
 * caching is the adapter's concern.
 */

import type {
  TmsConnection,
  TmsDocument,
  TmsEvent,
  TmsShipment,
  TmsSubscriptionRequest,
  TmsSubscriptionResult,
} from "./types";

export interface TmsAdapter {
  /** Stable provider id, must match tms.providers.provider_id */
  readonly providerId: string;

  /** Human-readable name shown in the dashboard */
  readonly name: string;

  /**
   * Liveness / auth probe. Returns ok:true when the configured
   * connection can authenticate end-to-end. Used by the smoke-test
   * page and connection wizard.
   */
  healthCheck(connection: TmsConnection): Promise<{
    ok: boolean;
    message: string;
    details?: Record<string, unknown>;
  }>;

  /**
   * Parse an inbound payload (webhook body, AMQP message, file drop).
   * Returns canonical TmsEvents - one payload may contain multiple
   * events (eAdaptor Universal Interchange wraps a collection).
   *
   * Errors thrown here cause the receiver to record the event as
   * `failed` with the error message. Caller does NOT re-throw.
   */
  parseInboundEvent(payload: string, contentType: string): Promise<TmsEvent[]>;

  /**
   * Subscribe to track a TMS reference (MBOL, AWB, consignment).
   * Adapters that don't support push tracking should throw
   * UnsupportedOperationError.
   */
  createSubscription(
    connection: TmsConnection,
    request: TmsSubscriptionRequest,
    callbackUrl: string,
  ): Promise<TmsSubscriptionResult>;

  /**
   * Cancel an existing subscription. Best effort - some TMSes don't
   * confirm cancellation synchronously.
   */
  cancelSubscription(connection: TmsConnection, clientReference: string): Promise<void>;

  /**
   * Pull a shipment by its TMS reference. Used for one-off lookup,
   * dashboard refresh, and on-demand sync.
   */
  fetchShipment?(connection: TmsConnection, tmsRef: string): Promise<TmsShipment | null>;

  /** List documents associated with a TMS reference. */
  listDocuments?(connection: TmsConnection, tmsRef: string): Promise<TmsDocument[]>;

  /** Fetch document bytes. Returns Buffer + content type. */
  fetchDocumentBytes?(
    connection: TmsConnection,
    tmsDocId: string,
  ): Promise<{ bytes: Buffer; contentType: string }>;
}

export class UnsupportedOperationError extends Error {
  constructor(
    public readonly providerId: string,
    public readonly operation: string,
    message?: string,
  ) {
    super(message ?? `${providerId} adapter does not support: ${operation}`);
    this.name = "UnsupportedOperationError";
  }
}

export class TmsAuthError extends Error {
  constructor(public readonly providerId: string, message: string) {
    super(message);
    this.name = "TmsAuthError";
  }
}

export class TmsAdapterError extends Error {
  constructor(
    public readonly providerId: string,
    public readonly operation: string,
    message: string,
    public readonly cause?: unknown,
  ) {
    super(`[${providerId}/${operation}] ${message}`);
    this.name = "TmsAdapterError";
  }
}
