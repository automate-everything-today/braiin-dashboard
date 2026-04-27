/**
 * Carrier inference from MBOL / MAWB prefixes.
 *
 * Ocean carriers issue Master Bills of Lading whose first 4 letters are
 * the carrier's SCAC (Standard Carrier Alpha Code). Air carriers issue
 * Air Waybills prefixed with a 3-digit IATA accounting code. Both
 * conventions let us infer the carrier from the reference alone, which
 * is a meaningful UX win on the subscribe form (one less field to ask
 * the user for).
 *
 * Tables curated for the carriers Corten and the wider freight industry
 * actually move volume on. Long tail not exhaustive - returns null for
 * unknown prefixes and the caller asks for the carrier code manually.
 *
 * Sources: NMFTA SCAC registry, IATA airline accounting codes (publicly
 * documented). Updates land via PR.
 */

/** SCAC -> { code, name } for the major ocean / NVOCC carriers. */
export const OCEAN_CARRIERS: Record<string, { code: string; name: string }> = {
  MAEU: { code: "MAEU", name: "Maersk Line" },
  MSCU: { code: "MSCU", name: "MSC (Mediterranean Shipping Company)" },
  CMDU: { code: "CMDU", name: "CMA CGM" },
  ONEY: { code: "ONEY", name: "Ocean Network Express (ONE)" },
  HLCU: { code: "HLCU", name: "Hapag-Lloyd" },
  EGLV: { code: "EGLV", name: "Evergreen Marine" },
  COSU: { code: "COSU", name: "COSCO Shipping Lines" },
  OOLU: { code: "OOLU", name: "OOCL (Orient Overseas)" },
  YMLU: { code: "YMLU", name: "Yang Ming Marine" },
  HDMU: { code: "HDMU", name: "HMM" },
  ZIMU: { code: "ZIMU", name: "ZIM Integrated Shipping" },
  PABV: { code: "PABV", name: "Pacific International Lines (PIL)" },
  SUDU: { code: "SUDU", name: "Hamburg Sud" },
  WHLC: { code: "WHLC", name: "Wan Hai Lines" },
  KKLU: { code: "KKLU", name: "K Line" },
  MOLU: { code: "MOLU", name: "MOL (Mitsui O.S.K. Lines)" },
  NYKS: { code: "NYKS", name: "NYK Line" },
  APLU: { code: "APLU", name: "APL" },
  ANRM: { code: "ANRM", name: "Arkas Container Transport" },
  TLLU: { code: "TLLU", name: "TS Lines" },
  RCLB: { code: "RCLB", name: "RCL (Regional Container Lines)" },
  GRIU: { code: "GRIU", name: "Grimaldi Group" },
  SCIU: { code: "SCIU", name: "Shipping Corporation of India" },
  TSLU: { code: "TSLU", name: "Trans Asian Shipping Services" },
  CGSU: { code: "CGSU", name: "CGS Shipping" },
  IRSU: { code: "IRSU", name: "IRISL Group" },
  ESLU: { code: "ESLU", name: "Emirates Shipping Line" },
  // NVOCCs / consolidators commonly seen on inbound mail
  EMCU: { code: "EMCU", name: "Emirates Shipping Line" },
  CHVW: { code: "CHVW", name: "China United Lines" },
  SAFM: { code: "SAFM", name: "Safmarine" },
  PCIU: { code: "PCIU", name: "PIL (Pacific International)" },
};

/** IATA 3-digit airline accounting codes -> airline. */
export const AIRLINE_PREFIXES: Record<string, { code: string; iataCode?: string; name: string }> = {
  "001": { code: "001", iataCode: "AA", name: "American Airlines" },
  "014": { code: "014", iataCode: "AA", name: "American Airlines Cargo" },
  "016": { code: "016", iataCode: "UA", name: "United Airlines" },
  "020": { code: "020", iataCode: "LH", name: "Lufthansa" },
  "027": { code: "027", iataCode: "DL", name: "Delta Air Lines" },
  "037": { code: "037", iataCode: "US", name: "US Airways" },
  "043": { code: "043", iataCode: "AS", name: "Alaska Airlines" },
  "047": { code: "047", iataCode: "TS", name: "Air Transat" },
  "057": { code: "057", iataCode: "AF", name: "Air France" },
  "064": { code: "064", iataCode: "OK", name: "Czech Airlines" },
  "065": { code: "065", iataCode: "SV", name: "Saudia" },
  "071": { code: "071", iataCode: "ET", name: "Ethiopian Airlines" },
  "074": { code: "074", iataCode: "KL", name: "KLM" },
  "075": { code: "075", iataCode: "IB", name: "Iberia" },
  "077": { code: "077", iataCode: "MS", name: "EgyptAir" },
  "081": { code: "081", iataCode: "QF", name: "Qantas" },
  "082": { code: "082", iataCode: "SN", name: "Brussels Airlines" },
  "083": { code: "083", iataCode: "SA", name: "South African Airways" },
  "086": { code: "086", iataCode: "NZ", name: "Air New Zealand" },
  "098": { code: "098", iataCode: "AC", name: "Air Canada" },
  "105": { code: "105", iataCode: "AZ", name: "ITA Airways (Alitalia)" },
  "112": { code: "112", iataCode: "OS", name: "Austrian Airlines" },
  "117": { code: "117", iataCode: "SK", name: "SAS Scandinavian" },
  "125": { code: "125", iataCode: "BA", name: "British Airways" },
  "131": { code: "131", iataCode: "JL", name: "Japan Airlines (JAL)" },
  "139": { code: "139", iataCode: "AR", name: "Aerolineas Argentinas" },
  "157": { code: "157", iataCode: "RJ", name: "Royal Jordanian" },
  "160": { code: "160", iataCode: "CX", name: "Cathay Pacific" },
  "172": { code: "172", iataCode: "CV", name: "Cargolux" },
  "176": { code: "176", iataCode: "MS", name: "EgyptAir Cargo" },
  "180": { code: "180", iataCode: "KE", name: "Korean Air" },
  "181": { code: "181", iataCode: "MH", name: "Malaysia Airlines" },
  "188": { code: "188", iataCode: "SQ", name: "Singapore Airlines" },
  "200": { code: "200", iataCode: "WA", name: "MyTravel Airways" },
  "205": { code: "205", iataCode: "NW", name: "Northwest Airlines" },
  "212": { code: "212", iataCode: "ME", name: "Middle East Airlines" },
  "217": { code: "217", iataCode: "TP", name: "TAP Air Portugal" },
  "220": { code: "220", iataCode: "LH", name: "Lufthansa Cargo" },
  "230": { code: "230", iataCode: "CZ", name: "China Southern" },
  "232": { code: "232", iataCode: "MK", name: "Air Mauritius" },
  "235": { code: "235", iataCode: "TK", name: "Turkish Airlines" },
  "236": { code: "236", iataCode: "MU", name: "China Eastern" },
  "237": { code: "237", iataCode: "SU", name: "Aeroflot" },
  "238": { code: "238", iataCode: "AY", name: "Finnair" },
  "239": { code: "239", iataCode: "CY", name: "Cyprus Airways" },
  "257": { code: "257", iataCode: "SR", name: "Swiss International" },
  "265": { code: "265", iataCode: "SQ", name: "Singapore Airlines Cargo" },
  "270": { code: "270", iataCode: "FX", name: "FedEx" },
  "297": { code: "297", iataCode: "CI", name: "China Airlines" },
  "369": { code: "369", iataCode: "5Y", name: "Atlas Air" },
  "388": { code: "388", iataCode: "BG", name: "Biman Bangladesh" },
  "406": { code: "406", iataCode: "PO", name: "Polar Air Cargo" },
  "417": { code: "417", iataCode: "PR", name: "Philippine Airlines" },
  "423": { code: "423", iataCode: "SK", name: "SAS Cargo" },
  "434": { code: "434", iataCode: "OZ", name: "Asiana Airlines" },
  "461": { code: "461", iataCode: "CZ", name: "China Southern Cargo" },
  "465": { code: "465", iataCode: "NH", name: "All Nippon Airways (ANA)" },
  "471": { code: "471", iataCode: "EK", name: "Emirates SkyCargo" },
  "543": { code: "543", iataCode: "GA", name: "Garuda Indonesia" },
  "555": { code: "555", iataCode: "9W", name: "Jet Airways" },
  "580": { code: "580", iataCode: "5C", name: "ASL Airlines Belgium" },
  "607": { code: "607", iataCode: "AH", name: "Air Algerie" },
  "615": { code: "615", iataCode: "BR", name: "EVA Air" },
  "618": { code: "618", iataCode: "SQ", name: "Singapore Airlines" },
  "624": { code: "624", iataCode: "5X", name: "UPS Airlines" },
  "632": { code: "632", iataCode: "CX", name: "Cathay Pacific Cargo" },
  "636": { code: "636", iataCode: "CK", name: "China Cargo Airlines" },
  "664": { code: "664", iataCode: "EY", name: "Etihad Airways" },
  "684": { code: "684", iataCode: "ET", name: "Ethiopian Airlines Cargo" },
  "695": { code: "695", iataCode: "BI", name: "Royal Brunei Airlines" },
  "706": { code: "706", iataCode: "KQ", name: "Kenya Airways" },
  "722": { code: "722", iataCode: "5J", name: "Cebu Pacific" },
  "724": { code: "724", iataCode: "OZ", name: "Asiana Cargo" },
  "729": { code: "729", iataCode: "MU", name: "China Eastern Cargo" },
  "738": { code: "738", iataCode: "SC", name: "Shandong Airlines" },
  "739": { code: "739", iataCode: "CK", name: "China Cargo Airlines" },
  "744": { code: "744", iataCode: "MK", name: "Air Mauritius Cargo" },
  "769": { code: "769", iataCode: "EY", name: "Etihad Cargo" },
  "775": { code: "775", iataCode: "AT", name: "Royal Air Maroc" },
  "776": { code: "776", iataCode: "SV", name: "Saudia Cargo" },
  "781": { code: "781", iataCode: "EK", name: "Emirates SkyCargo" },
  "784": { code: "784", iataCode: "QF", name: "Qantas Freight" },
  "858": { code: "858", iataCode: "TK", name: "Turkish Cargo" },
  "859": { code: "859", iataCode: "3U", name: "Sichuan Airlines" },
  "874": { code: "874", iataCode: "QR", name: "Qatar Airways Cargo" },
  "880": { code: "880", iataCode: "CA", name: "Air China" },
  "888": { code: "888", iataCode: "HU", name: "Hainan Airlines" },
  "923": { code: "923", iataCode: "K4", name: "Kalitta Air" },
  "988": { code: "988", iataCode: "OZ", name: "Asiana Cargo" },
  "997": { code: "997", iataCode: "PO", name: "Polar Air Cargo" },
};

export interface CarrierInference {
  code: string;
  name: string;
  source: "scac" | "iata-prefix";
}

/**
 * Given an MBOL (master bill) reference, return the issuing ocean
 * carrier when the SCAC prefix is recognised. SCACs are 4 alpha chars
 * at the start of the reference; everything after is the bill number.
 */
export function inferCarrierFromMbol(mbol: string): CarrierInference | null {
  const cleaned = mbol.trim().toUpperCase();
  if (cleaned.length < 5) return null;
  const prefix = cleaned.slice(0, 4);
  if (!/^[A-Z]{4}$/.test(prefix)) return null;
  const hit = OCEAN_CARRIERS[prefix];
  if (!hit) return null;
  return { code: hit.code, name: hit.name, source: "scac" };
}

/**
 * Given an MAWB (master air waybill), return the issuing airline when
 * the 3-digit IATA accounting prefix is recognised. MAWBs are formatted
 * as `XXX-NNNNNNNN` or just `XXXNNNNNNNN`. We tolerate a hyphen or no
 * separator.
 */
export function inferCarrierFromMawb(mawb: string): CarrierInference | null {
  const cleaned = mawb.trim().toUpperCase().replace(/[\s\-]/g, "");
  if (cleaned.length < 4) return null;
  const prefix = cleaned.slice(0, 3);
  if (!/^[0-9]{3}$/.test(prefix)) return null;
  const hit = AIRLINE_PREFIXES[prefix];
  if (!hit) return null;
  return { code: hit.code, name: hit.name, source: "iata-prefix" };
}

/**
 * Given a container number (e.g. TRHU1919450), return the owner when
 * the 4-letter prefix matches a known carrier-owned container range.
 * Most carriers reuse their SCAC for container ownership too, so this
 * delegates to the SCAC lookup with a slight caveat - container codes
 * follow ISO 6346 (4 alpha owner code, 7 digits).
 */
export function inferOwnerFromContainerNumber(container: string): CarrierInference | null {
  const cleaned = container.trim().toUpperCase();
  // ISO 6346: 4 alpha owner code + U/J/Z (category) + 7 digits
  if (!/^[A-Z]{4}[UJZ]?\d{6,7}$/.test(cleaned)) return null;
  const prefix = cleaned.slice(0, 4);
  const hit = OCEAN_CARRIERS[prefix];
  if (!hit) return null;
  return { code: hit.code, name: hit.name, source: "scac" };
}
