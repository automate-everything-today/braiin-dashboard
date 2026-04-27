/**
 * High-level eAdaptor operations.
 *
 * Each function is a thin wrapper that:
 *   1. Resolves the connection's secrets (env vars)
 *   2. Builds the request XML
 *   3. POSTs via postEdaptorXml
 *   4. Parses the UniversalResponse / UniversalShipment / UniversalEvent body
 *   5. Writes an audit row to tms.outbound_calls
 *
 * Audit is best-effort: a logging failure doesn't break the call.
 * Credentials never appear in logs, error messages, or audit rows.
 */

import { TmsAdapterError } from "../../adapter";
import { logOutboundCall, type OutboundStatus } from "../../audit";
import type { TmsConnection, TmsRefType, TmsShipment } from "../../types";
import { resolveEdaptorSecrets } from "./auth";
import { postEdaptorXml } from "./client";
import {
  buildDocumentRequestXml,
  buildShipmentRequestXml,
  parseDocumentResponseXml,
  parseUniversalResponseXml,
  shipmentXmlToCanonical,
  type DocumentFilter,
  type ParsedDocumentRow,
} from "./xml";

const SHIPMENT_QUERY_OP = "shipment_query";
const DOCUMENT_QUERY_OP = "document_query";

/** Map eAdaptor data-target types to canonical tms ref types. */
function refTypeForDataTarget(type: string): TmsRefType {
  switch (type) {
    case "ForwardingShipment":
      return "shipment";
    case "ForwardingConsol":
      return "consol";
    case "CustomsDeclaration":
      return "job";
    default:
      return "job";
  }
}

/**
 * Fetch a single shipment / consol / declaration by Cargowise key.
 *
 * `dataTargetType` examples: 'ForwardingShipment', 'ForwardingConsol',
 * 'CustomsDeclaration'. `key` is the job number (e.g. 'AS123456').
 *
 * Returns null when the entity isn't found or the response status is
 * a non-success code; in both cases the audit row is written.
 */
export async function fetchShipmentByKey(
  connection: TmsConnection,
  options: {
    dataTargetType: string;
    key: string;
    requestedBy: string;
  },
): Promise<TmsShipment | null> {
  const requestedAt = new Date();
  const summary = `target=${options.dataTargetType} key=${options.key}`;
  let status: OutboundStatus = "success";
  let httpStatus: number | null = null;
  let errorMessage: string | null = null;
  let bytesReceived: number | null = null;
  let result: TmsShipment | null = null;

  try {
    const secrets = resolveEdaptorSecrets(connection.secretsRef, connection.config);
    const xml = buildShipmentRequestXml({
      type: options.dataTargetType,
      key: options.key,
      enterpriseId: secrets.enterpriseId,
      serverId: secrets.serverId,
      companyCode: secrets.companyCode,
    });
    const bytesSent = Buffer.byteLength(xml, "utf8");

    const { status: resHttpStatus, body } = await postEdaptorXml(secrets, xml);
    httpStatus = resHttpStatus;
    bytesReceived = Buffer.byteLength(body, "utf8");

    let envelope;
    try {
      envelope = parseUniversalResponseXml(body);
    } catch (err) {
      status = "parse_error";
      errorMessage = err instanceof Error ? err.message : String(err);
      throw new TmsAdapterError("cargowise", "edaptor.fetchShipment", errorMessage);
    }

    if (envelope.errorMessage) {
      status = "http_error";
      errorMessage = envelope.errorMessage.slice(0, 500);
    } else if (envelope.shipment) {
      result = shipmentXmlToCanonical(envelope.shipment, {
        tmsRef: options.key,
        tmsRefType: refTypeForDataTarget(options.dataTargetType),
      });
    }

    return result;
  } catch (err) {
    if (status === "success") status = "http_error";
    errorMessage = errorMessage ?? (err instanceof Error ? err.message : String(err));
    if (errorMessage?.toLowerCase().includes("auth") || httpStatus === 401) {
      status = "auth_error";
    }
    throw err;
  } finally {
    const completedAt = new Date();
    void logOutboundCall({
      orgId: connection.orgId,
      connectionId: connection.connectionId === "synthetic" ? null : connection.connectionId,
      providerId: "cargowise",
      operation: SHIPMENT_QUERY_OP,
      requestedBy: options.requestedBy,
      requestSummary: summary,
      requestedAt,
      completedAt,
      durationMs: completedAt.getTime() - requestedAt.getTime(),
      status,
      httpStatus,
      errorMessage,
      bytesReceived,
    });
  }
}

/**
 * List documents for a Cargowise entity. When descriptionsOnly=true,
 * returns metadata only (no base64 payload) - much smaller responses,
 * suitable for "show me the docs on this job" UI.
 */
export async function listDocumentsByKey(
  connection: TmsConnection,
  options: {
    dataTargetType: string;
    key: string;
    filters?: DocumentFilter[];
    descriptionsOnly?: boolean;
    requestedBy: string;
  },
): Promise<ParsedDocumentRow[]> {
  const requestedAt = new Date();
  const summary = `target=${options.dataTargetType} key=${options.key} descriptionsOnly=${
    options.descriptionsOnly ?? false
  }`;
  let status: OutboundStatus = "success";
  let httpStatus: number | null = null;
  let errorMessage: string | null = null;
  let bytesReceived: number | null = null;
  let documents: ParsedDocumentRow[] = [];

  try {
    const secrets = resolveEdaptorSecrets(connection.secretsRef, connection.config);
    const xml = buildDocumentRequestXml({
      type: options.dataTargetType,
      key: options.key,
      enterpriseId: secrets.enterpriseId,
      serverId: secrets.serverId,
      companyCode: secrets.companyCode,
      filters: options.filters,
      descriptionsOnly: options.descriptionsOnly,
    });

    const { status: resHttpStatus, body } = await postEdaptorXml(secrets, xml);
    httpStatus = resHttpStatus;
    bytesReceived = Buffer.byteLength(body, "utf8");

    try {
      documents = parseDocumentResponseXml(body);
    } catch (err) {
      status = "parse_error";
      errorMessage = err instanceof Error ? err.message : String(err);
      throw new TmsAdapterError("cargowise", "edaptor.listDocuments", errorMessage);
    }

    return documents;
  } catch (err) {
    if (status === "success") status = "http_error";
    errorMessage = errorMessage ?? (err instanceof Error ? err.message : String(err));
    if (errorMessage?.toLowerCase().includes("auth") || httpStatus === 401) {
      status = "auth_error";
    }
    throw err;
  } finally {
    const completedAt = new Date();
    void logOutboundCall({
      orgId: connection.orgId,
      connectionId: connection.connectionId === "synthetic" ? null : connection.connectionId,
      providerId: "cargowise",
      operation: DOCUMENT_QUERY_OP,
      requestedBy: options.requestedBy,
      requestSummary: summary,
      requestedAt,
      completedAt,
      durationMs: completedAt.getTime() - requestedAt.getTime(),
      status,
      httpStatus,
      errorMessage,
      bytesReceived,
    });
  }
}
