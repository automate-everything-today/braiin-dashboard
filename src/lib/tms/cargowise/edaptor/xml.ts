/**
 * eAdaptor HTTP+XML message builders and parsers.
 *
 * Implements:
 *   - UniversalShipmentRequest builder
 *   - UniversalDocumentRequest builder
 *   - UniversalResponse parser (envelope + status + payload extraction)
 *   - Universal Shipment XML parser to canonical TmsShipment (best-effort)
 *
 * The Universal Shipment XML schema is huge (Shipment, Order, Container,
 * ChargeLine, Note, Reference, Address, ...). We parse the slice that
 * maps cleanly to TmsShipment and pass the rest through as `metadata`.
 * Callers that need more can read the raw payload from tms.documents
 * or tms.events.
 */

import { XMLBuilder, XMLParser } from "fast-xml-parser";
import type { ContainerMode, TmsRefType, TmsShipment, TransportMode } from "../../types";

export const UNIVERSAL_NS = "http://www.cargowise.com/Schemas/Universal/2011/11";

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  textNodeName: "#text",
  // Hard-disable entity expansion - DoS hardening (see cargo-visibility/xml.ts).
  processEntities: false,
  isArray: (name: string): boolean => {
    return (
      name === "DataTarget" ||
      name === "Filter" ||
      name === "Container" ||
      name === "ChargeLine" ||
      name === "Note" ||
      name === "Reference" ||
      name === "Document" ||
      name === "DataSource"
    );
  },
});

const builder = new XMLBuilder({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  textNodeName: "#text",
  format: true,
  indentBy: "  ",
  suppressEmptyNode: false,
});

// ---------- request builders ----------

interface DataContextOptions {
  enterpriseId?: string;
  serverId?: string;
  companyCode?: string;
}

interface DataTargetOptions extends DataContextOptions {
  type: string; // 'ForwardingShipment' | 'ForwardingConsol' | 'CustomsDeclaration' | ...
  key: string;
}

function buildDataContextNode(opts: DataTargetOptions) {
  const dc: Record<string, unknown> = {
    DataTargetCollection: {
      DataTarget: { Type: opts.type, Key: opts.key },
    },
  };
  if (opts.companyCode) dc.Company = { Code: opts.companyCode };
  if (opts.enterpriseId) dc.EnterpriseID = opts.enterpriseId;
  if (opts.serverId) dc.ServerID = opts.serverId;
  return dc;
}

export function buildShipmentRequestXml(opts: DataTargetOptions): string {
  const obj = {
    "?xml": { "@_version": "1.0", "@_encoding": "utf-8" },
    UniversalShipmentRequest: {
      "@_xmlns": UNIVERSAL_NS,
      "@_version": "1.1",
      ShipmentRequest: {
        DataContext: buildDataContextNode(opts),
      },
    },
  };
  return builder.build(obj);
}

export interface DocumentFilter {
  /** 'DocumentType' | 'IsPublished' | 'CompanyCode' | 'BranchCode' | 'FileName' | 'DocumentID' | 'RelatedEDoc' | etc */
  type: string;
  value: string;
}

export interface DocumentRequestOptions extends DataTargetOptions {
  filters?: DocumentFilter[];
  /** When true, returns just file metadata without the bulky base64 content. */
  descriptionsOnly?: boolean;
}

export function buildDocumentRequestXml(opts: DocumentRequestOptions): string {
  const docReq: Record<string, unknown> = {
    DataContext: buildDataContextNode(opts),
  };
  if (opts.filters && opts.filters.length > 0) {
    docReq.FilterCollection = {
      Filter: opts.filters.map((f) => ({ Type: f.type, Value: f.value })),
    };
  }
  if (opts.descriptionsOnly) {
    docReq.ReturnDocumentDescriptionsOnly = "true";
  }

  const obj = {
    "?xml": { "@_version": "1.0", "@_encoding": "utf-8" },
    UniversalDocumentRequest: {
      "@_xmlns": UNIVERSAL_NS,
      "@_version": "1.1",
      DocumentRequest: docReq,
    },
  };
  return builder.build(obj);
}

// ---------- response parsing ----------

interface ParsedUniversalResponse {
  UniversalResponse?: {
    Status?: string;
    StatusCode?: string;
    Data?: unknown;
    ErrorMessage?: string;
    Errors?: unknown;
  };
  UniversalShipment?: unknown;
  UniversalEvent?: unknown;
}

export interface UniversalResponseEnvelope {
  status: string | null;
  errorMessage: string | null;
  shipment: ParsedShipmentXml | null;
  events: unknown[];
  raw: unknown;
}

export interface ParsedShipmentXml {
  // Anything in the Shipment block we recognise
  jobNumber?: string;
  consolNumber?: string;
  mbolNumber?: string;
  hbolNumber?: string;
  transportMode?: string;
  containerMode?: string;
  carrierCode?: string;
  carrierName?: string;
  vesselName?: string;
  voyageNumber?: string;
  originUnloco?: string;
  destinationUnloco?: string;
  eta?: string;
  etd?: string;
  ata?: string;
  atd?: string;
  containers?: Array<Record<string, unknown>>;
  chargeLines?: Array<Record<string, unknown>>;
  raw: unknown;
}

function pickString(obj: unknown, ...keys: string[]): string | undefined {
  if (!obj || typeof obj !== "object") return undefined;
  const o = obj as Record<string, unknown>;
  for (const k of keys) {
    const v = o[k];
    if (typeof v === "string" && v.trim()) return v.trim();
    if (v && typeof v === "object") {
      const inner = (v as Record<string, unknown>)["#text"];
      if (typeof inner === "string" && inner.trim()) return inner.trim();
    }
  }
  return undefined;
}

function unwrapShipment(payload: unknown): ParsedShipmentXml | null {
  if (!payload || typeof payload !== "object") return null;
  // The shape is typically:
  //   <UniversalShipment>
  //     <Shipment>
  //       <DataSource>...</DataSource>
  //       ...lots of fields...
  //       <ContainerCollection><Container>...</Container></ContainerCollection>
  //       <ChargeLineCollection>...
  //     </Shipment>
  //   </UniversalShipment>
  const universal = (payload as Record<string, unknown>).UniversalShipment;
  const shipment = universal && typeof universal === "object"
    ? (universal as Record<string, unknown>).Shipment
    : (payload as Record<string, unknown>).Shipment;

  if (!shipment || typeof shipment !== "object") return null;
  const s = shipment as Record<string, unknown>;

  const containers = (() => {
    const cc = s.ContainerCollection as Record<string, unknown> | undefined;
    if (!cc) return undefined;
    const list = cc.Container as Array<Record<string, unknown>> | undefined;
    return Array.isArray(list) ? list : undefined;
  })();

  const chargeLines = (() => {
    const cc = s.JobCosting as Record<string, unknown> | undefined;
    if (!cc) return undefined;
    const cl = cc.ChargeLineCollection as Record<string, unknown> | undefined;
    if (!cl) return undefined;
    const list = cl.ChargeLine as Array<Record<string, unknown>> | undefined;
    return Array.isArray(list) ? list : undefined;
  })();

  return {
    jobNumber: pickString(s, "JobNumber", "Reference"),
    consolNumber: pickString(s, "ConsolNumber"),
    mbolNumber: pickString(s, "WayBillNumber", "MasterBillNumber"),
    hbolNumber: pickString(s, "HouseBillNumber"),
    transportMode: pickString(s, "TransportMode"),
    containerMode: pickString(s, "ContainerMode"),
    carrierCode: pickString(s.OceanLine ?? s.Carrier, "Code"),
    carrierName: pickString(s.OceanLine ?? s.Carrier, "Name"),
    vesselName: pickString(s, "VesselName"),
    voyageNumber: pickString(s, "VoyageFlightNo", "VoyageNumber"),
    originUnloco: pickString(s.PortOfLoading ?? s.PlaceOfReceipt, "Code"),
    destinationUnloco: pickString(s.PortOfDischarge ?? s.PlaceOfDelivery, "Code"),
    eta: pickString(s, "ETA", "EstimatedArrival"),
    etd: pickString(s, "ETD", "EstimatedDeparture"),
    ata: pickString(s, "ATA", "ActualArrival"),
    atd: pickString(s, "ATD", "ActualDeparture"),
    containers,
    chargeLines,
    raw: shipment,
  };
}

/**
 * Parse a UniversalResponse / UniversalShipment XML body. CargoWise's
 * response shapes vary by component - sometimes a UniversalResponse
 * envelope wraps the data, sometimes a UniversalShipment is returned
 * directly. This handles both.
 */
export function parseUniversalResponseXml(xml: string): UniversalResponseEnvelope {
  let parsed: ParsedUniversalResponse;
  try {
    parsed = parser.parse(xml) as ParsedUniversalResponse;
  } catch (err) {
    throw new Error(
      `Failed to parse eAdaptor XML response: ${err instanceof Error ? err.message : err}`,
    );
  }

  const universalResponse = parsed.UniversalResponse;
  const status = universalResponse
    ? pickString(universalResponse, "Status", "StatusCode") ?? null
    : null;
  const errorMessage = universalResponse
    ? pickString(universalResponse, "ErrorMessage") ?? null
    : null;

  let shipment: ParsedShipmentXml | null = null;
  if (universalResponse?.Data) {
    shipment = unwrapShipment(universalResponse.Data);
  }
  if (!shipment && parsed.UniversalShipment) {
    shipment = unwrapShipment(parsed);
  }

  const events: unknown[] = [];
  if (universalResponse && (universalResponse as Record<string, unknown>).UniversalEvent) {
    const ue = (universalResponse as Record<string, unknown>).UniversalEvent;
    if (Array.isArray(ue)) events.push(...ue);
    else events.push(ue);
  }

  return { status, errorMessage, shipment, events, raw: parsed };
}

// ---------- canonical mapping ----------

function mapTransportMode(raw: string | undefined): TransportMode | null {
  if (!raw) return null;
  const v = raw.trim().toUpperCase();
  if (v === "SEA" || v === "OCEAN") return "SEA";
  if (v === "AIR") return "AIR";
  if (v === "RAI" || v === "RAIL") return "RAIL";
  if (v === "ROA" || v === "ROAD") return "ROAD";
  if (v === "COURIER") return "COURIER";
  if (v === "MULTI" || v === "MULTIMODAL") return "MULTI";
  return null;
}

function mapContainerMode(raw: string | undefined): ContainerMode | null {
  if (!raw) return null;
  const v = raw.trim().toUpperCase();
  if (v === "FCL" || v === "LCL" || v === "BCN" || v === "OTH") return v;
  return null;
}

function parseDate(raw: string | undefined): Date | undefined {
  if (!raw) return undefined;
  const d = new Date(raw);
  return Number.isFinite(d.getTime()) ? d : undefined;
}

export function shipmentXmlToCanonical(
  parsed: ParsedShipmentXml,
  fallbackRef: { tmsRef: string; tmsRefType: TmsRefType },
): TmsShipment {
  return {
    providerId: "cargowise",
    tmsRef: parsed.jobNumber ?? parsed.consolNumber ?? fallbackRef.tmsRef,
    tmsRefType: fallbackRef.tmsRefType,
    jobNumber: parsed.jobNumber,
    consolNumber: parsed.consolNumber,
    mbolNumber: parsed.mbolNumber,
    hbolNumber: parsed.hbolNumber,
    transportMode: mapTransportMode(parsed.transportMode),
    containerMode: mapContainerMode(parsed.containerMode),
    origin: parsed.originUnloco ? { unlocode: parsed.originUnloco } : undefined,
    destination: parsed.destinationUnloco ? { unlocode: parsed.destinationUnloco } : undefined,
    carrierCode: parsed.carrierCode,
    carrierName: parsed.carrierName,
    vesselName: parsed.vesselName,
    voyageNumber: parsed.voyageNumber,
    eta: parseDate(parsed.eta),
    etd: parseDate(parsed.etd),
    ata: parseDate(parsed.ata),
    atd: parseDate(parsed.atd),
    metadata: { raw: parsed.raw },
  };
}

// ---------- document parsing ----------

export interface ParsedDocumentRow {
  documentId?: string;
  fileName?: string;
  documentType?: string;
  contentType?: string;
  isPublished?: string;
  saveDateUtc?: string;
  /** base64-encoded body when ReturnDocumentDescriptionsOnly was false */
  data?: string;
}

export function parseDocumentResponseXml(xml: string): ParsedDocumentRow[] {
  const root = parser.parse(xml) as Record<string, unknown>;
  const documents: ParsedDocumentRow[] = [];

  // Document responses come back as UniversalEvent payloads with a
  // ContextCollection holding the document descriptors.
  // The exact shape varies but typically lives under
  // UniversalEvent -> Event -> AttachedDocumentCollection -> AttachedDocument
  const ue = (root.UniversalEvent ?? root.UniversalResponse) as Record<string, unknown> | undefined;
  if (!ue) return documents;

  const ev = (ue.Event ?? ue) as Record<string, unknown>;
  const adc = ev.AttachedDocumentCollection as Record<string, unknown> | undefined;
  if (!adc) return documents;
  const list = adc.AttachedDocument;
  const arr = Array.isArray(list) ? list : list ? [list] : [];

  for (const d of arr as Array<Record<string, unknown>>) {
    documents.push({
      documentId: pickString(d, "DocumentID", "DocumentId"),
      fileName: pickString(d, "FileName", "Name"),
      documentType: pickString(d.Type ?? d.DocumentType, "Code") ?? pickString(d, "Type"),
      contentType: pickString(d, "ContentType", "MimeType"),
      isPublished: pickString(d, "IsPublished"),
      saveDateUtc: pickString(d, "SaveDateUtc", "SaveDateUTC"),
      data: pickString(d, "Data", "FileContent"),
    });
  }

  return documents;
}
