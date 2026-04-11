export const DEPARTMENTS = ["Management", "Accounts", "Air", "Customs", "Sea", "Road", "Warehouse", "Sales", "Ops"] as const;
export type Department = typeof DEPARTMENTS[number];

export const BRANCHES = ["London HQ", "Manchester", "Southampton", "Heathrow", "Newcastle", "International"] as const;

export const COUNTRIES = ["UK", "Turkey", "Spain", "Poland", "India", "Germany", "France", "USA", "Brazil", "UAE", "Netherlands", "China", "Philippines"] as const;

export const VERTICALS = [
  "pharma", "retail", "automotive", "oil_gas", "ecommerce", "projects",
  "events", "aog", "ship_spares", "time_critical", "air", "ocean",
  "road", "rail", "warehousing", "general",
] as const;

export const DEPT_COLORS: Record<string, string> = {
  Management: "bg-purple-100 text-purple-700",
  Accounts: "bg-green-100 text-green-700",
  Air: "bg-yellow-100 text-yellow-700",
  Customs: "bg-teal-100 text-teal-700",
  Sea: "bg-blue-100 text-blue-700",
  Road: "bg-zinc-200 text-zinc-700",
  Warehouse: "bg-orange-100 text-orange-700",
  Sales: "bg-[#ff3366]/10 text-[#ff3366]",
  Ops: "bg-cyan-100 text-cyan-700",
};

export const TIER_COLORS: Record<string, string> = {
  Platinum: "bg-purple-600 text-white",
  Gold: "bg-yellow-500 text-black",
  Silver: "bg-zinc-400 text-white",
  Bronze: "bg-orange-700 text-white",
  Starter: "bg-zinc-200 text-zinc-600",
};

export const DEPT_ORDER: Record<string, number> = {
  Management: 0, Accounts: 1, Air: 2, Customs: 3, Sea: 4,
  Road: 5, Warehouse: 6, Sales: 7, Ops: 8,
};

export const EBIT_THRESHOLD = 300000;
export const BONUS_PCT = 0.50;
export const EQUITY_PCT = 0.075;
