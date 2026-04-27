/**
 * Cargowise TMS adapter.
 *
 * Implements the TmsAdapter interface against:
 *   - Cargo Visibility API (modern, JWT auth, webhook + AMQP)
 *   - eAdaptor (SOAP / HTTP+XML) - placeholder, to be added in a
 *     follow-up commit once we have working eAdaptor credentials
 *
 * The Cargo Visibility surface alone covers live shipment tracking,
 * which is the highest-value initial integration (real-time vessel
 * status, container milestones, ETAs visible in Braiin).
 */

import { randomUUID } from "node:crypto";
import {
  TmsAdapter,
  TmsAdapterError,
  TmsAuthError,
  UnsupportedOperationError,
} from "../adapter";
import type {
  TmsConnection,
  TmsEvent,
  TmsSubscriptionRequest,
  TmsSubscriptionResult,
} from "../types";
import { getCargoVisibilityToken, resolveAuthSecrets } from "./cargo-visibility/auth";
import { deleteCargoVisibility, postUniversalXml } from "./cargo-visibility/client";
import {
  buildSubscriptionXml,
  parseUniversalInterchange,
  type SubscriptionXmlInput,
} from "./cargo-visibility/xml";
import {
  inferCarrierFromMawb,
  inferCarrierFromMbol,
  inferOwnerFromContainerNumber,
} from "./carrier-lookup";
import { fetchShipmentByKey, listDocumentsByKey } from "./edaptor/queries";
import type { TmsDocument } from "../types";

const CV_SUBSCRIPTIONS_PATH = "/api/v1/cargo-tracking/subscriptions";

export const cargowiseAdapter: TmsAdapter = {
  providerId: "cargowise",
  name: "CargoWise (WiseTech Global)",

  async healthCheck(connection: TmsConnection) {
    try {
      const secrets = resolveAuthSecrets(connection.secretsRef);
      const token = await getCargoVisibilityToken(secrets);
      return {
        ok: true,
        message: "Cargo Visibility token issued successfully",
        details: { tokenLength: token.length, clientId: secrets.clientId },
      };
    } catch (err) {
      if (err instanceof TmsAuthError) {
        return { ok: false, message: err.message };
      }
      return {
        ok: false,
        message: err instanceof Error ? err.message : String(err),
      };
    }
  },

  async parseInboundEvent(payload: string, contentType: string): Promise<TmsEvent[]> {
    if (!contentType.toLowerCase().includes("xml")) {
      throw new TmsAdapterError(
        "cargowise",
        "parseInbound",
        `Unexpected content-type "${contentType}" - Cargo Visibility delivers XML`,
      );
    }
    return parseUniversalInterchange(payload);
  },

  async createSubscription(
    connection: TmsConnection,
    request: TmsSubscriptionRequest,
    callbackUrl: string,
  ): Promise<TmsSubscriptionResult> {
    const clientReference = request.clientReference ?? randomUUID();

    const xmlInput: SubscriptionXmlInput = {
      callbackAddress: callbackUrl,
      clientReference,
      carrierCode: request.carrierCode,
      transportMode:
        request.transportMode === "SEA" || request.transportMode === "AIR"
          ? request.transportMode
          : undefined,
      containerMode:
        request.containerMode === "FCL" || request.containerMode === "LCL"
          ? request.containerMode
          : undefined,
      eta: request.eta,
      etd: request.etd,
      vessel:
        request.vesselName || request.voyageNumber
          ? { name: request.vesselName, voyageNumber: request.voyageNumber }
          : undefined,
      mbolOriginUnloco: request.origin?.unlocode,
      mbolDestinationUnloco: request.destination?.unlocode,
      legOriginUnloco: request.origin?.unlocode,
      legDestinationUnloco: request.destination?.unlocode,
      containerNumbers: request.containerNumbers,
    };

    // Auto-infer carrier when not supplied and the reference is a
    // recognised SCAC / IATA prefix. This is the UX win on the
    // smoke-test form - users only have to paste the ref.
    if (!xmlInput.carrierCode || !xmlInput.carrierName) {
      let inferred = null;
      if (request.tmsRefType === "mbol") inferred = inferCarrierFromMbol(request.tmsRef);
      else if (request.tmsRefType === "awb") inferred = inferCarrierFromMawb(request.tmsRef);
      else if (request.tmsRefType === "container") inferred = inferOwnerFromContainerNumber(request.tmsRef);
      if (inferred) {
        xmlInput.carrierCode = xmlInput.carrierCode ?? inferred.code;
        xmlInput.carrierName = xmlInput.carrierName ?? inferred.name;
      }
    }

    if (request.tmsRefType === "mbol") {
      xmlInput.mbolNumber = request.tmsRef;
    } else if (request.tmsRefType === "awb") {
      xmlInput.mawbNumber = request.tmsRef;
    } else if (request.tmsRefType === "container") {
      xmlInput.containerNumber = request.tmsRef;
      // Container-keyed subscriptions imply ocean
      if (!xmlInput.transportMode) xmlInput.transportMode = "SEA";
    } else if (request.tmsRefType === "booking") {
      xmlInput.carriersBookingReference = request.tmsRef;
    } else {
      throw new TmsAdapterError(
        "cargowise",
        "createSubscription",
        `Cargo Visibility subscriptions support tmsRefType=mbol|awb|container|booking, got "${request.tmsRefType}"`,
      );
    }

    const xml = buildSubscriptionXml(xmlInput);

    const { body } = await postUniversalXml(connection, CV_SUBSCRIPTIONS_PATH, xml);

    // Parse the response - either an IRA (acknowledged) or IRJ (rejected)
    // event, optionally wrapped in a UniversalInterchange.
    const events = parseUniversalInterchange(body);
    const ackEvent = events.find((e) => e.eventType === "IRA");
    const rejectEvent = events.find((e) => e.eventType === "IRJ");

    if (rejectEvent) {
      const reason =
        rejectEvent.context["RejectionReason"] ??
        rejectEvent.context["Reason"] ??
        "Subscription rejected";
      return {
        clientReference,
        status: "rejected",
        rejectionReason: reason,
        rawResponse: body,
      };
    }
    if (ackEvent) {
      return { clientReference, status: "acknowledged", rawResponse: body };
    }
    return { clientReference, status: "pending", rawResponse: body };
  },

  async cancelSubscription(connection: TmsConnection, clientReference: string): Promise<void> {
    // CV's subscription DELETE keys on the subscription ID, not our
    // ClientReference. The current implementation needs the caller to
    // resolve subscription_id first; this keeps the door open and
    // throws clearly until that piece lands.
    void connection;
    void clientReference;
    throw new UnsupportedOperationError(
      "cargowise",
      "cancelSubscription",
      "Use the manage-subscription endpoint with the SubscriptionId; ClientReference-only cancellation is not yet wired",
    );
  },

  // fetchShipment + listDocuments are implemented via eAdaptor HTTP+XML
  // (the broader Cargowise integration surface). Cargo Visibility only
  // covers tracking events - jobs, charges, and documents come from
  // eAdaptor.

  async fetchShipment(connection, tmsRef) {
    // Default to ForwardingShipment - the smoke page can override via
    // request.metadata when other module types are needed.
    return await fetchShipmentByKey(connection, {
      dataTargetType: "ForwardingShipment",
      key: tmsRef,
      requestedBy: "service_role",
    });
  },

  async listDocuments(connection, tmsRef): Promise<TmsDocument[]> {
    const rows = await listDocumentsByKey(connection, {
      dataTargetType: "ForwardingShipment",
      key: tmsRef,
      descriptionsOnly: true,
      requestedBy: "service_role",
    });
    return rows.map((r) => ({
      providerId: "cargowise",
      tmsDocId: r.documentId ?? "",
      tmsRef,
      tmsRefType: "shipment",
      docType: r.documentType ?? "unknown",
      contentType: r.contentType,
      metadata: {
        fileName: r.fileName,
        isPublished: r.isPublished,
        saveDateUtc: r.saveDateUtc,
      },
    }));
  },
};

export {
  parseUniversalInterchange,
  buildSubscriptionXml,
} from "./cargo-visibility/xml";
export { getCargoVisibilityToken } from "./cargo-visibility/auth";
