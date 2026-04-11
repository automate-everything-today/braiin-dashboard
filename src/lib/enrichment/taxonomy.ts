export const SERVICE_TYPES = [
  { group: "Freight", items: [
    "International Freight", "Domestic Freight", "FCL (Full Container)", "LCL (Groupage)",
    "FTL (Full Truckload)", "LTL (Part Load)", "Air Freight", "Sea Freight", "Road Freight",
    "Rail Freight", "Multimodal", "Project Cargo", "Out of Gauge", "Dangerous Goods",
    "Temperature Controlled", "Express/Time Critical",
  ]},
  { group: "Transport", items: [
    "Container Haulage", "General Haulage", "Pallet Distribution", "Courier",
    "Last Mile Delivery", "Collection Service", "Trunking",
  ]},
  { group: "Carrier", items: [
    "Shipping Line", "Airline", "NVOCC", "Freight Train Operator",
  ]},
  { group: "Services", items: [
    "Customs Brokerage", "Customs Clearance", "AEO Certified", "Warehousing",
    "Pick and Pack", "Cross-dock", "Container Storage", "Insurance",
    "Cargo Survey", "Fumigation", "Packaging",
  ]},
  { group: "Other", items: [
    "Freight Forwarder", "IATA Agent", "Port/Terminal", "Software Provider",
    "Consulting", "Other",
  ]},
];

export const ALL_SERVICES = SERVICE_TYPES.flatMap(g => g.items);

export const MODES = ["FCL", "LCL", "Air", "Road", "Rail", "Courier", "Multimodal", "Project"];

export const COUNTRIES: string[] = [
  "UK", "Turkey", "China", "India", "USA", "Germany", "France", "Spain", "Italy",
  "Netherlands", "Belgium", "Poland", "UAE", "Saudi Arabia", "Singapore", "Hong Kong",
  "Japan", "South Korea", "Australia", "Brazil", "Mexico", "Canada", "South Africa",
  "Nigeria", "Kenya", "Egypt", "Morocco", "Pakistan", "Bangladesh", "Vietnam",
  "Thailand", "Indonesia", "Malaysia", "Philippines", "Taiwan", "Sri Lanka",
  "Ireland", "Portugal", "Greece", "Romania", "Czech Republic", "Sweden", "Norway",
  "Denmark", "Finland", "Austria", "Switzerland", "Russia", "Ukraine",
];

const SERVICE_ALIASES: Record<string, string> = {
  "ocean freight": "Sea Freight",
  "sea shipping": "Sea Freight",
  "ocean shipping": "Sea Freight",
  "seafreight": "Sea Freight",
  "airfreight": "Air Freight",
  "air cargo": "Air Freight",
  "air shipping": "Air Freight",
  "road transport": "Road Freight",
  "road haulage": "Road Freight",
  "trucking": "Road Freight",
  "rail transport": "Rail Freight",
  "railway freight": "Rail Freight",
  "full container load": "FCL (Full Container)",
  "fcl": "FCL (Full Container)",
  "less than container load": "LCL (Groupage)",
  "lcl": "LCL (Groupage)",
  "groupage": "LCL (Groupage)",
  "consolidation": "LCL (Groupage)",
  "full truck load": "FTL (Full Truckload)",
  "ftl": "FTL (Full Truckload)",
  "part load": "LTL (Part Load)",
  "ltl": "LTL (Part Load)",
  "customs": "Customs Brokerage",
  "customs broker": "Customs Brokerage",
  "clearance": "Customs Clearance",
  "customs clearance": "Customs Clearance",
  "warehousing": "Warehousing",
  "storage": "Warehousing",
  "distribution": "Pallet Distribution",
  "haulage": "Container Haulage",
  "container haulage": "Container Haulage",
  "drayage": "Container Haulage",
  "last mile": "Last Mile Delivery",
  "courier": "Courier",
  "express": "Express/Time Critical",
  "time critical": "Express/Time Critical",
  "project cargo": "Project Cargo",
  "heavy lift": "Project Cargo",
  "breakbulk": "Project Cargo",
  "out of gauge": "Out of Gauge",
  "oog": "Out of Gauge",
  "oversize": "Out of Gauge",
  "dangerous goods": "Dangerous Goods",
  "hazmat": "Dangerous Goods",
  "dg": "Dangerous Goods",
  "imdg": "Dangerous Goods",
  "temperature controlled": "Temperature Controlled",
  "reefer": "Temperature Controlled",
  "cold chain": "Temperature Controlled",
  "fumigation": "Fumigation",
  "packaging": "Packaging",
  "packing": "Packaging",
  "insurance": "Insurance",
  "cargo insurance": "Insurance",
  "pick and pack": "Pick and Pack",
  "cross dock": "Cross-dock",
  "cross-docking": "Cross-dock",
  "container storage": "Container Storage",
  "cargo survey": "Cargo Survey",
  "survey": "Cargo Survey",
  "freight forwarding": "Freight Forwarder",
  "freight forwarder": "Freight Forwarder",
  "nvocc": "NVOCC",
  "shipping line": "Shipping Line",
  "airline": "Airline",
  "iata": "IATA Agent",
  "iata agent": "IATA Agent",
  "aeo": "AEO Certified",
  "aeo certified": "AEO Certified",
  "multimodal": "Multimodal",
  "intermodal": "Multimodal",
};

const MODE_ALIASES: Record<string, string> = {
  "ocean": "FCL",
  "sea": "FCL",
  "ocean freight": "FCL",
  "sea freight": "FCL",
  "full container": "FCL",
  "groupage": "LCL",
  "consolidation": "LCL",
  "air freight": "Air",
  "air cargo": "Air",
  "airfreight": "Air",
  "road freight": "Road",
  "trucking": "Road",
  "road haulage": "Road",
  "rail freight": "Rail",
  "railway": "Rail",
  "courier service": "Courier",
  "express": "Courier",
  "multimodal": "Multimodal",
  "intermodal": "Multimodal",
  "project cargo": "Project",
  "heavy lift": "Project",
  "breakbulk": "Project",
};

export function mapService(raw: string): string | null {
  const lower = raw.toLowerCase().trim();
  const direct = ALL_SERVICES.find(s => s.toLowerCase() === lower);
  if (direct) return direct;
  if (SERVICE_ALIASES[lower]) return SERVICE_ALIASES[lower];
  const partial = ALL_SERVICES.find(s => lower.includes(s.toLowerCase()));
  if (partial) return partial;
  return null;
}

export function mapMode(raw: string): string | null {
  const lower = raw.toLowerCase().trim();
  const direct = MODES.find(m => m.toLowerCase() === lower);
  if (direct) return direct;
  if (MODE_ALIASES[lower]) return MODE_ALIASES[lower];
  return null;
}

export function mapServices(raw: string[]): string[] {
  const mapped = raw.map(mapService).filter((s): s is string => s !== null);
  return [...new Set(mapped)];
}

export function mapModes(raw: string[]): string[] {
  const mapped = raw.map(mapMode).filter((m): m is string => m !== null);
  return [...new Set(mapped)];
}

export function mergeArrays(existing: string[], incoming: string[]): string[] {
  return [...new Set([...existing, ...incoming])];
}

// Roles allowed to use enrichment features
export const ENRICHMENT_ROLES = ["super_admin", "admin", "branch_md", "sales", "sales_manager", "manager"];

export function canAccessEnrichment(role?: string): boolean {
  return ENRICHMENT_ROLES.includes(role || "");
}
