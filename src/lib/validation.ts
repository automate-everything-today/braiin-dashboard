import { z } from "zod";

export const RELATIONSHIP_TYPES = ["direct_client", "forwarder_agent", "supplier"] as const;
export const SERVICE_CATEGORIES = [
  "shipping_line", "airline", "road_haulier", "courier", "customs_broker",
  "warehouse", "software", "insurance", "port_terminal", "other",
] as const;
export const FINANCIAL_DIRECTIONS = ["receivable", "payable", "both"] as const;
export const ACCOUNT_STATUSES = ["active", "on_hold", "blacklisted", "dormant"] as const;
export const CONTEXT_TYPES = ["email", "deal", "account", "incident", "general"] as const;
export const INCIDENT_SEVERITIES = ["amber", "red", "black"] as const;
export const INCIDENT_CATEGORIES = [
  "delay", "failed_collection", "rolled", "short_shipped", "documentation_error",
  "customs_hold", "damage", "lost_cargo", "failed_to_fly", "temperature_breach",
  "contamination", "claim", "demurrage", "theft", "bankruptcy", "failure_to_pay",
  "staff_misconduct", "regulatory_breach", "hse", "fraud", "other",
] as const;
export const INCIDENT_STATUSES = ["open", "investigating", "resolved", "escalated"] as const;
export const NOTIFICATION_TYPES = ["mention", "incident", "reply", "escalation", "system"] as const;

export const accountSchema = z.object({
  account_code: z.string().optional(),
  company_name: z.string().min(1, "Company name is required"),
  trading_name: z.string().optional(),
  domain: z.string().optional(),
  logo_url: z.string().optional(),
  relationship_types: z.array(z.enum(RELATIONSHIP_TYPES)).min(1).default(["direct_client"]),
  service_categories: z.array(z.enum(SERVICE_CATEGORIES)).default([]),
  financial_direction: z.enum(FINANCIAL_DIRECTIONS).default("receivable"),
  status: z.enum(ACCOUNT_STATUSES).default("active"),
  credit_terms: z.string().optional(),
  payment_terms: z.string().optional(),
  vat_number: z.string().optional(),
  country: z.string().optional(),
  city: z.string().optional(),
  address: z.string().optional(),
  phone: z.string().optional(),
  notes: z.string().optional(),
  source: z.enum(["cargowise", "manual", "enrichment"]).default("manual"),
});

export const messageSchema = z.object({
  content: z.string().min(1, "Message cannot be empty"),
  context_type: z.enum(CONTEXT_TYPES),
  context_id: z.string().optional(),
  context_summary: z.string().optional(),
  context_url: z.string().optional(),
  parent_id: z.number().nullable().optional(),
  mentions: z.array(z.string().email()).optional(),
});

export const incidentSchema = z.object({
  severity: z.enum(INCIDENT_SEVERITIES),
  title: z.string().min(1, "Title is required"),
  description: z.string().optional(),
  category: z.enum(INCIDENT_CATEGORIES),
  account_code: z.string().optional(),
  supplier_account_code: z.string().optional(),
  job_reference: z.string().optional(),
  assigned_to: z.string().optional(),
  branch: z.string().optional(),
  financial_impact: z.number().nullable().optional(),
  source: z.enum(["manual", "email_ai", "deal", "message"]).default("manual"),
  source_id: z.string().optional(),
  responsible_party: z.string().optional(),
  responsible_type: z.string().optional(),
  root_cause: z.string().optional(),
});

export const notificationSchema = z.object({
  user_email: z.string().email(),
  type: z.enum(NOTIFICATION_TYPES),
  title: z.string().min(1),
  body: z.string().optional(),
  severity: z.enum(INCIDENT_SEVERITIES).nullable().optional(),
  source_type: z.string().optional(),
  source_id: z.string().optional(),
  link: z.string().optional(),
});

export function apiResponse<T>(data: T, status = 200): Response {
  return Response.json(data, { status });
}

export function apiError(message: string, status = 400): Response {
  return Response.json({ error: message }, { status });
}

export function validationError(error: z.ZodError): Response {
  const messages = error.issues.map(e => `${e.path.join(".")}: ${e.message}`).join(", ");
  return Response.json({ error: `Validation failed: ${messages}` }, { status: 400 });
}

export type AccountInput = z.infer<typeof accountSchema>;
export type MessageInput = z.infer<typeof messageSchema>;
export type IncidentInput = z.infer<typeof incidentSchema>;
export type NotificationInput = z.infer<typeof notificationSchema>;
