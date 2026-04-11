export type IncidentSeverity = "amber" | "red" | "black";
export type IncidentCategory = "delay" | "failed_collection" | "rolled" | "short_shipped" | "documentation_error" | "customs_hold" | "damage" | "lost_cargo" | "failed_to_fly" | "temperature_breach" | "contamination" | "claim" | "demurrage" | "theft" | "bankruptcy" | "failure_to_pay" | "staff_misconduct" | "regulatory_breach" | "hse" | "fraud" | "other";
export type IncidentStatus = "open" | "investigating" | "resolved" | "escalated";

export interface Incident {
  id: number;
  severity: IncidentSeverity;
  title: string;
  description: string;
  category: IncidentCategory;
  account_code: string | null;
  supplier_account_code: string | null;
  job_reference: string | null;
  status: IncidentStatus;
  raised_by_email: string;
  raised_by_name: string;
  assigned_to: string | null;
  branch: string;
  resolution_notes: string | null;
  resolved_at: string | null;
  resolved_by: string | null;
  financial_impact: number | null;
  source: "manual" | "email_ai" | "deal" | "message";
  source_id: string | null;
  created_at: string;
  updated_at: string;
}
