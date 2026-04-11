export type RelationshipType = "direct_client" | "forwarder_agent" | "supplier";
export type ServiceCategory = "shipping_line" | "airline" | "road_haulier" | "courier" | "customs_broker" | "warehouse" | "software" | "insurance" | "port_terminal" | "other";
export type FinancialDirection = "receivable" | "payable" | "both";
export type AccountStatus = "active" | "on_hold" | "blacklisted" | "dormant";

export interface Account {
  id: number;
  account_code: string;
  company_name: string;
  trading_name: string;
  domain: string;
  logo_url: string;
  relationship_types: RelationshipType[];
  service_categories: ServiceCategory[];
  financial_direction: FinancialDirection;
  status: AccountStatus;
  blacklist_reason: string | null;
  blacklist_incident_id: number | null;
  credit_terms: string;
  payment_terms: string;
  vat_number: string;
  country: string;
  city: string;
  address: string;
  phone: string;
  source: "cargowise" | "manual" | "enrichment";
  notes: string;
  created_at: string;
  updated_at: string;
}
