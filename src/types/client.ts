export interface ClientPerformance {
  account_code: string;
  client_name: string;
  report_month: string;
  total_jobs: number;
  fcl_jobs: number;
  lcl_jobs: number;
  air_jobs: number;
  bbk_jobs: number;
  fcl_teu: number;
  air_kg: number;
  bbk_cbm: number;
  profit_total: number;
  profit_fcl: number;
  profit_lcl: number;
  profit_air: number;
  profit_bbk: number;
}

export interface ClientResearch {
  account_code: string;
  client_news: string;
  growth_signals: string[];
  retention_risks: string[];
  competitor_intel: string;
  recommended_action: string;
  account_health: "growing" | "stable" | "at_risk";
  source_links: string[];
  research_date: string;
  insight: string;
  ff_networks: string[];
  logo_url: string;
  is_forwarder: boolean;
  country: string;
  chat_history: ChatMessage[];
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface ClientNote {
  id: number;
  account_code: string;
  note: string;
  author: string;
  created_at: string;
}

export interface ClientEmail {
  id: number;
  account_code: string;
  from_email: string;
  from_name: string;
  to_email: string;
  to_name: string;
  subject: string;
  body: string;
  resend_id: string;
  status: string;
  sent_at: string;
}

export interface ClientData {
  code: string;
  name: string;
  totalProfit: number;
  totalJobs: number;
  months: number;
  avgMonthly: number;
  lastMonth: string;
  tier: "Platinum" | "Gold" | "Silver" | "Bronze" | "Starter";
  monthly: MonthlyData[];
  modes: { fcl: number; lcl: number; air: number; bbk: number };
  modeProfits: { fcl: number; lcl: number; air: number; bbk: number };
  totalTeu: number;
  totalAirKg: number;
  totalBbkCbm: number;
  logoUrl: string;
  tradeMatch: TradeMatch | null;
  upsellOpportunities: string[];
  clientNews: string;
  growthSignals: string[];
  retentionRisks: string[];
  competitorIntel: string;
  recommendedAction: string;
  accountHealth: string;
  researched: boolean;
  isForwarder: boolean;
  country: string;
  sourceLinks: string[];
  researchDate: string;
  insight: string;
  ffNetworks: string[];
}

export interface MonthlyData {
  month: string;
  label: string;
  profit: number;
  fcl: number;
  lcl: number;
  air: number;
  bbk: number;
  teu: number;
  air_kg: number;
  bbk_cbm: number;
}

export interface TradeMatch {
  ultimate_score: number;
  grade: string;
  import_volume: number;
  export_volume: number;
  import_months: number;
  export_months: number;
  is_dual: boolean;
}
