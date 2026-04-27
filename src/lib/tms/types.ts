/**
 * Provider-agnostic canonical types for the TMS abstraction.
 *
 * Concrete adapters (cargowise, magaya, ...) translate their proprietary
 * shapes into and out of these types. Code outside src/lib/tms/<provider>/
 * should only ever see canonical types.
 */

export type TmsProviderId = "cargowise" | "magaya" | string;

export type TransportMode = "SEA" | "AIR" | "ROAD" | "RAIL" | "COURIER" | "MULTI";

export type ContainerMode = "FCL" | "LCL" | "BCN" | "OTH";

/** Reference types we use to identify TMS-side records. */
export type TmsRefType =
  | "job"
  | "consol"
  | "shipment"
  | "mbol"           // master bill of lading
  | "hbol"           // house bill of lading
  | "awb"            // air waybill (master)
  | "hawb"           // house air waybill
  | "container"      // container number (e.g. TRHU1919450)
  | "booking"        // carrier's booking reference (covers SI / SO / SE / PO refs)
  | "consignment"
  | "invoice"
  | "document";

/** Canonical inbound TMS event. */
export interface TmsEvent {
  /** Stable provider id (registered in tms.providers) */
  providerId: TmsProviderId;

  /** Provider's event type code, e.g. 'ARV', 'GIN', 'IRA' for Cargowise */
  eventType: string;

  /** Event timestamp per the TMS (UTC) - null if not provided */
  eventTime: Date | null;

  /** Our subscription ClientReference, echoed back by the TMS */
  clientReference: string | null;

  /** Primary TMS reference this event relates to */
  tmsRef: string | null;
  tmsRefType: TmsRefType | null;

  /** Carrier context when known */
  carrierCode: string | null;
  transportMode: TransportMode | null;

  /** Free-form key/value pairs from the event payload */
  context: Record<string, string>;

  /** Sub-context blocks, e.g. transport legs, locations */
  subContexts?: Array<Record<string, string>>;

  /** Raw payload preserved for re-parsing */
  rawPayload: string;
  payloadFormat: "xml" | "json" | "edi";
}

/** Canonical TMS shipment view (eAdaptor Universal Shipment, Magaya shipment, ...) */
export interface TmsShipment {
  providerId: TmsProviderId;
  tmsRef: string;
  tmsRefType: TmsRefType;

  jobNumber?: string;
  consolNumber?: string;
  mbolNumber?: string;
  hbolNumber?: string;

  transportMode: TransportMode | null;
  containerMode: ContainerMode | null;

  origin?: TmsLocationRef;
  destination?: TmsLocationRef;

  carrierCode?: string;
  carrierName?: string;
  vesselName?: string;
  voyageNumber?: string;

  eta?: Date;
  etd?: Date;
  ata?: Date;
  atd?: Date;

  /** Job costing / charge lines if present */
  charges?: TmsCharge[];

  /** Container records when applicable */
  containers?: TmsContainer[];

  /** Document references on the shipment */
  documentRefs?: Array<{ docType: string; tmsDocId: string }>;

  metadata: Record<string, unknown>;
}

export interface TmsLocationRef {
  /** UN/LOCODE when known (5 chars). */
  unlocode?: string;
  /** Free-text fallback */
  name?: string;
  countryCode?: string;
}

export interface TmsCharge {
  chargeCode: string;
  description?: string;
  amount: number;
  currency: string;
  side: "cost" | "revenue";
}

export interface TmsContainer {
  containerNumber: string;
  containerType?: string;          // ISO 6346 size/type ('22G1' = 20GP)
  sealNumber?: string;
  weight?: { value: number; unit: "KG" | "LBS" };
}

/** Canonical TMS document descriptor */
export interface TmsDocument {
  providerId: TmsProviderId;
  tmsDocId: string;
  tmsRef: string;
  tmsRefType: TmsRefType;
  docType: string;                 // 'BL', 'AWB', 'invoice', 'eDoc', ...
  contentType?: string;
  bytes?: number;
  fetchUrl?: string;               // where to GET the bytes from the TMS
  metadata: Record<string, unknown>;
}

/** Subscription request - what we ask the TMS to track */
export interface TmsSubscriptionRequest {
  tmsRef: string;
  tmsRefType: TmsRefType;
  carrierCode?: string;
  transportMode?: TransportMode;
  containerMode?: ContainerMode;
  origin?: TmsLocationRef;
  destination?: TmsLocationRef;
  eta?: Date;
  etd?: Date;
  vesselName?: string;
  voyageNumber?: string;
  containerNumbers?: string[];
  /** Optional metadata bag carried as the round-trip ClientReference */
  clientReference?: string;
}

/** Subscription as returned by the TMS */
export interface TmsSubscriptionResult {
  clientReference: string;
  status: "pending" | "acknowledged" | "rejected";
  rejectionReason?: string;
  rawResponse?: string;
}

/** Connection config row read from tms.connections */
export interface TmsConnection {
  connectionId: string;
  orgId: string;
  providerId: TmsProviderId;
  name: string;
  authMethod: string;
  secretsRef: Record<string, string>;
  config: Record<string, unknown>;
  enabled: boolean;
}
