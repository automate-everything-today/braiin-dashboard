/**
 * Universal Interchange / Universal Event XML for Cargo Visibility.
 *
 * Both inbound (events from CV) and outbound (subscription requests
 * to CV) use the same envelope shape:
 *
 *   <UniversalInterchange xmlns="http://www.cargowise.com/Schemas/Universal/2011/11">
 *     <Header />
 *     <Body>
 *       <UniversalEvent>
 *         <Event>
 *           <EventTime>...</EventTime>
 *           <EventType>...</EventType>
 *           <EventParameters>...</EventParameters>     (optional)
 *           <ContextCollection>
 *             <Context><Type>...</Type><Value>...</Value>
 *               <SubContextCollection>...optional...</SubContextCollection>
 *             </Context>
 *             ...
 *           </ContextCollection>
 *           <MessageNumberCollection>
 *             <MessageNumber Type="...">...</MessageNumber>
 *           </MessageNumberCollection>
 *         </Event>
 *       </UniversalEvent>
 *     </Body>
 *   </UniversalInterchange>
 *
 * fast-xml-parser is configured to preserve attributes and to keep
 * arrays consistent (single-element collections still come back as
 * arrays so callers don't need defensive `Array.isArray` checks).
 */

import { XMLBuilder, XMLParser } from "fast-xml-parser";
import type { TmsEvent, TmsRefType, TransportMode } from "../../types";

export const UNIVERSAL_NS = "http://www.cargowise.com/Schemas/Universal/2011/11";

interface ParsedContext {
  Type: string;
  Value: string;
  SubContextCollection?: { SubContext: ParsedSubContext[] };
}

interface ParsedSubContext {
  Type: string;
  Value: string;
}

interface ParsedEvent {
  EventTime?: string;
  EventType: string;
  EventReference?: string;
  IsEstimate?: string;
  EventParameters?: Record<string, string>;
  ContextCollection?: { Context: ParsedContext[] };
  MessageNumberCollection?: {
    MessageNumber: Array<{ "#text": string; "@_Type": string }>;
  };
}

interface ParsedInterchange {
  UniversalInterchange?: {
    Body?: {
      UniversalEvent?:
        | { Event: ParsedEvent }
        | Array<{ Event: ParsedEvent }>;
    };
  };
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  textNodeName: "#text",
  // Always treat these as arrays - simplifies downstream code.
  isArray: (name: string): boolean => {
    return (
      name === "Context" ||
      name === "SubContext" ||
      name === "MessageNumber" ||
      name === "UniversalEvent"
    );
  },
});

const builder = new XMLBuilder({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  textNodeName: "#text",
  format: true,
  indentBy: "    ",
  suppressEmptyNode: false,
});

// ---------- inbound ----------

function parseEventTime(raw: string | undefined): Date | null {
  if (!raw) return null;
  // CV emits both 'YYYY-MM-DDTHH:mm' and 'YYYY-MM-DDTHH:mm:ssZ' shapes
  // (and IRA/IRJ are explicitly UTC). new Date() handles both.
  const d = new Date(raw);
  return Number.isFinite(d.getTime()) ? d : null;
}

function pickContext(contexts: ParsedContext[], type: string): string | null {
  const hit = contexts.find((c) => c.Type.trim() === type);
  return hit?.Value?.toString().trim() || null;
}

function deriveTmsRefType(eventType: string, ctx: ParsedContext[]): {
  ref: string | null;
  refType: TmsRefType | null;
} {
  // For ocean cargo subscriptions the MBOL is the primary handle.
  // For air cargo it's the MAWB. CarriersBookingReference covers the
  // SI / SO / SE / PO mapping path. ContainerNumber lets us track
  // container-keyed subscriptions.
  const mbol = pickContext(ctx, "MBOLNumber");
  if (mbol) return { ref: mbol, refType: "mbol" };
  const mawb = pickContext(ctx, "MAWBNumber");
  if (mawb) return { ref: mawb, refType: "awb" };
  const booking = pickContext(ctx, "CarriersBookingReference");
  if (booking) return { ref: booking, refType: "booking" };
  const container = pickContext(ctx, "ContainerNumber");
  if (container) return { ref: container, refType: "container" };
  const consignment = pickContext(ctx, "ConsignmentNumber");
  if (consignment) return { ref: consignment, refType: "consignment" };
  return { ref: null, refType: null };
}

function deriveTransportMode(value: string | null): TransportMode | null {
  if (!value) return null;
  const v = value.trim().toUpperCase();
  if (v === "SEA" || v === "OCEAN") return "SEA";
  if (v === "AIR") return "AIR";
  if (v === "ROA" || v === "ROAD") return "ROAD";
  if (v === "RAI" || v === "RAIL") return "RAIL";
  return null;
}

/**
 * Parse a UniversalInterchange XML payload into one or more canonical
 * TmsEvents. The CV API can deliver multiple UniversalEvent blocks per
 * payload (especially for IRA/IRJ which can produce multi-event sequences).
 *
 * Throws on malformed XML; never returns partial state.
 */
export function parseUniversalInterchange(xml: string): TmsEvent[] {
  let parsed: ParsedInterchange;
  try {
    parsed = parser.parse(xml) as ParsedInterchange;
  } catch (err) {
    throw new Error(
      `Failed to parse UniversalInterchange XML: ${err instanceof Error ? err.message : err}`,
    );
  }

  const events: TmsEvent[] = [];
  const universalEvents = parsed.UniversalInterchange?.Body?.UniversalEvent;
  if (!universalEvents) return events;

  const list = Array.isArray(universalEvents) ? universalEvents : [universalEvents];

  for (const ue of list) {
    const ev = ue.Event;
    if (!ev || !ev.EventType) continue;

    const contextList = ev.ContextCollection?.Context ?? [];
    const context: Record<string, string> = {};
    const subContexts: Array<Record<string, string>> = [];

    for (const c of contextList) {
      if (c.Type && c.Value !== undefined) {
        context[c.Type.trim()] = String(c.Value).trim();
      }
      const subList = c.SubContextCollection?.SubContext ?? [];
      if (subList.length > 0) {
        const sub: Record<string, string> = { _parentType: c.Type?.trim() ?? "" };
        for (const s of subList) {
          if (s.Type && s.Value !== undefined) {
            sub[s.Type.trim()] = String(s.Value).trim();
          }
        }
        subContexts.push(sub);
      }
    }

    // Promote EventParameters into the context bag with a prefix so
    // they're not silently lost.
    if (ev.EventParameters) {
      for (const [k, v] of Object.entries(ev.EventParameters)) {
        context[`EventParameters.${k}`] = String(v);
      }
    }
    if (ev.EventReference) context["EventReference"] = String(ev.EventReference);
    if (ev.IsEstimate) context["IsEstimate"] = String(ev.IsEstimate);

    const { ref, refType } = deriveTmsRefType(ev.EventType, contextList);
    const carrierCode = pickContext(contextList, "CarrierCode");
    const transportMode =
      deriveTransportMode(context["EventParameters.TransportMode"] || null) ??
      deriveTransportMode(pickContext(contextList, "TransportMode"));

    events.push({
      providerId: "cargowise",
      eventType: ev.EventType.trim(),
      eventTime: parseEventTime(ev.EventTime),
      clientReference: pickContext(contextList, "ClientReference"),
      tmsRef: ref,
      tmsRefType: refType,
      carrierCode,
      transportMode,
      context,
      subContexts: subContexts.length > 0 ? subContexts : undefined,
      rawPayload: xml,
      payloadFormat: "xml",
    });
  }

  return events;
}

// ---------- outbound (subscription request builder) ----------

export interface SubscriptionXmlInput {
  // Primary reference - exactly one of these MUST be set per the
  // CV API contract. CarrierBookingReference covers SI / SO / SE / PO
  // refs that map to a single carrier-side booking ID.
  mbolNumber?: string;
  mawbNumber?: string;
  carriersBookingReference?: string;
  /** Container number primary key (ocean only) */
  containerNumber?: string;

  carrierCode?: string;
  carrierName?: string;
  transportMode?: "SEA" | "AIR";
  containerMode?: "FCL" | "LCL";

  /** Required - URL Cargo Visibility will POST events to */
  callbackAddress: string;

  /** Round-trip identifier echoed on every event - we mint a UUID */
  clientReference: string;

  /** Optional but recommended for ocean to disambiguate */
  mbolOriginUnloco?: string;
  mbolDestinationUnloco?: string;

  /** Optional vessel + voyage detail, encoded as a TransportLeg sub-context */
  vessel?: { name?: string; voyageNumber?: string };
  eta?: Date;
  etd?: Date;
  legOriginUnloco?: string;
  legDestinationUnloco?: string;

  /** Optional container numbers (ocean, plural). Use containerNumber above for primary. */
  containerNumbers?: string[];
}

interface ContextNode {
  Type: string;
  Value: string;
  SubContextCollection?: { SubContext: ContextNode[] };
}

function fmtDate(d: Date | undefined): string | undefined {
  if (!d) return undefined;
  return d.toISOString().split("T")[0];
}

/**
 * Build an SBR (Subscribe Request) UniversalInterchange XML payload.
 * The CV API documents this as the XML body of POST .../subscriptions.
 */
export function buildSubscriptionXml(input: SubscriptionXmlInput): string {
  const ctx: ContextNode[] = [];

  if (input.mbolNumber) {
    ctx.push({ Type: "MBOLNumber", Value: input.mbolNumber });
  }
  if (input.mawbNumber) {
    ctx.push({ Type: "MAWBNumber", Value: input.mawbNumber });
  }
  if (input.carriersBookingReference) {
    ctx.push({ Type: "CarriersBookingReference", Value: input.carriersBookingReference });
  }
  if (input.containerNumber) {
    ctx.push({ Type: "ContainerNumber", Value: input.containerNumber });
  }
  if (input.mbolOriginUnloco) {
    ctx.push({ Type: "MBOLOriginUNLOCO", Value: input.mbolOriginUnloco });
  }
  if (input.mbolDestinationUnloco) {
    ctx.push({ Type: "MBOLDestinationUNLOCO", Value: input.mbolDestinationUnloco });
  }
  if (input.carrierCode) {
    ctx.push({ Type: "CarrierCode", Value: input.carrierCode });
  }
  if (input.carrierName) {
    ctx.push({ Type: "Carrier", Value: input.carrierName });
  }
  if (input.transportMode) {
    ctx.push({ Type: "TransportMode", Value: input.transportMode });
  }
  if (input.containerMode) {
    ctx.push({ Type: "ContainerMode", Value: input.containerMode });
  }

  ctx.push({ Type: "CallbackAddress", Value: input.callbackAddress });
  ctx.push({ Type: "ClientReference", Value: input.clientReference });

  // Transport leg sub-context (when we know vessel/voyage/eta/etd)
  if (
    input.vessel?.name ||
    input.legOriginUnloco ||
    input.legDestinationUnloco ||
    input.eta ||
    input.etd
  ) {
    const sub: ContextNode[] = [];
    if (input.transportMode) sub.push({ Type: "TransportMode", Value: input.transportMode });
    if (input.legOriginUnloco) sub.push({ Type: "LegOriginUNLOCO", Value: input.legOriginUnloco });
    if (input.legDestinationUnloco) sub.push({ Type: "LegDestinationUNLOCO", Value: input.legDestinationUnloco });
    const eta = fmtDate(input.eta);
    const etd = fmtDate(input.etd);
    if (eta) sub.push({ Type: "EstimatedTimeOfArrival", Value: eta });
    if (etd) sub.push({ Type: "EstimatedTimeOfDeparture", Value: etd });
    if (input.vessel?.name) sub.push({ Type: "VesselName", Value: input.vessel.name });
    if (input.vessel?.voyageNumber) sub.push({ Type: "VoyageNumber", Value: input.vessel.voyageNumber });

    ctx.push({
      Type: "TransportLeg",
      Value: "1",
      SubContextCollection: { SubContext: sub },
    });
  }

  // Container numbers (ocean)
  if (input.containerNumbers && input.containerNumbers.length > 0) {
    for (const c of input.containerNumbers) {
      ctx.push({ Type: "ContainerNumber", Value: c });
    }
  }

  const obj = {
    "?xml": { "@_version": "1.0", "@_encoding": "utf-8" },
    UniversalInterchange: {
      "@_xmlns": UNIVERSAL_NS,
      Header: {},
      Body: {
        UniversalEvent: {
          Event: {
            EventType: "SBR",
            ContextCollection: { Context: ctx },
            MessageNumberCollection: {
              MessageNumber: { "#text": "1", "@_Type": "MessageNumber" },
            },
          },
        },
      },
    },
  };

  return builder.build(obj);
}
