// src/services/incidents.ts
import { supabase, ServiceError } from "./base";
import type { Incident } from "@/types";
import type { IncidentInput } from "@/lib/validation";
import { notifyUsers, createNotification } from "./notifications";
import { blacklistAccount } from "./accounts";

export const INCIDENT_TRIGGER_WORDS = {
  amber: [
    "delay", "delayed", "missed collection", "rolled", "short-shipped", "short shipped",
    "documentation error", "customs hold", "customs clearance issue", "awaiting",
    "overdue", "late delivery", "failed pickup", "rescheduled",
  ],
  red: [
    "damage", "damaged", "claim", "lost cargo", "missing cargo", "theft", "stolen",
    "failed to fly", "temperature breach", "cold chain", "contamination", "contaminated",
    "insurance claim", "demurrage dispute", "cargo shortage",
  ],
  black: [
    "total loss", "major claim", "bankruptcy", "liquidation", "administration", "winding up",
    "failure to pay", "non-payment", "overdue payment 90", "staff misconduct",
    "gross misconduct", "regulatory breach", "compliance violation", "fraud", "fraudulent",
    "hse incident", "serious injury", "fatality", "legal action", "lawsuit",
  ],
} as const;

export function getEscalationTargets(severity: string): string[] {
  switch (severity) {
    case "amber": return ["ops", "manager"];
    case "red": return ["manager", "branch_md"];
    case "black": return ["manager", "branch_md", "admin", "super_admin"];
    default: return [];
  }
}

export async function getIncidents(filters?: {
  severity?: string;
  status?: string;
  account_code?: string;
  supplier_account_code?: string;
  branch?: string;
  job_reference?: string;
}): Promise<Incident[]> {
  let query = supabase.from("incidents").select("*").order("created_at", { ascending: false });

  if (filters?.severity) query = query.eq("severity", filters.severity);
  if (filters?.status) query = query.eq("status", filters.status);
  if (filters?.account_code) query = query.eq("account_code", filters.account_code);
  if (filters?.supplier_account_code) query = query.eq("supplier_account_code", filters.supplier_account_code);
  if (filters?.branch) query = query.eq("branch", filters.branch);
  if (filters?.job_reference) query = query.eq("job_reference", filters.job_reference);

  const { data, error } = await query.limit(200);
  if (error) throw new ServiceError("Failed to fetch incidents", error, "INCIDENTS_FETCH");
  return (data || []) as Incident[];
}

export async function getIncidentById(id: number): Promise<Incident | null> {
  const { data, error } = await supabase.from("incidents")
    .select("*").eq("id", id).single();
  if (error && error.code !== "PGRST116") throw new ServiceError("Failed to fetch incident", error);
  return (data as Incident) || null;
}

export async function createIncident(
  input: IncidentInput,
  raisedBy: { email: string; name: string }
): Promise<Incident> {
  const { data, error } = await supabase.from("incidents")
    .insert({
      ...input,
      raised_by_email: raisedBy.email,
      raised_by_name: raisedBy.name,
      status: "open",
      updated_at: new Date().toISOString(),
    })
    .select().single();
  if (error) throw new ServiceError("Failed to create incident", error, "INCIDENT_CREATE");

  const incident = data as Incident;

  // Escalation: notify relevant staff by role
  const targetRoles = getEscalationTargets(incident.severity);
  const { data: staffList } = await supabase.from("staff")
    .select("email, access_role, branch")
    .eq("is_active", true)
    .in("access_role", targetRoles);

  const recipientEmails = (staffList || [])
    .filter((s: any) => {
      // For amber/red, only notify same branch + higher roles
      if (incident.severity === "black") return true;
      if (s.branch === incident.branch) return true;
      if (["admin", "super_admin", "branch_md"].includes(s.access_role)) return true;
      return false;
    })
    .map((s: any) => s.email)
    .filter((e: string) => e !== raisedBy.email);

  if (recipientEmails.length > 0) {
    const severityLabel = incident.severity.toUpperCase();
    await notifyUsers(recipientEmails, {
      type: "incident",
      title: `${severityLabel}: ${incident.title}`,
      body: incident.description?.slice(0, 200) || "",
      severity: incident.severity,
      source_type: "incident",
      source_id: String(incident.id),
      link: `/incidents?id=${incident.id}`,
    });
  }

  // Black: blacklist the account(s)
  if (incident.severity === "black") {
    if (incident.supplier_account_code) {
      await blacklistAccount(incident.supplier_account_code, incident.title, incident.id).catch((err) => {
        console.error(
          `[incidents] Failed to blacklist supplier ${incident.supplier_account_code} for incident ${incident.id}:`,
          err,
        );
      });
    }
    if (incident.account_code && incident.category === "failure_to_pay") {
      await blacklistAccount(incident.account_code, incident.title, incident.id).catch((err) => {
        console.error(
          `[incidents] Failed to blacklist account ${incident.account_code} for incident ${incident.id}:`,
          err,
        );
      });
    }
  }

  // Log to activities
  await supabase.from("activities").insert({
    account_code: incident.account_code || "",
    type: "incident_raised",
    subject: `${incident.severity.toUpperCase()} incident: ${incident.title}`,
    body: `Category: ${incident.category}. Raised by ${raisedBy.name}.`,
  });

  return incident;
}

export async function updateIncident(
  id: number,
  updates: Partial<Pick<Incident, "status" | "assigned_to" | "resolution_notes" | "resolved_by">>
): Promise<Incident> {
  const payload: any = { ...updates, updated_at: new Date().toISOString() };
  if (updates.status === "resolved") {
    payload.resolved_at = new Date().toISOString();
  }

  const { data, error } = await supabase.from("incidents")
    .update(payload).eq("id", id).select().single();
  if (error) throw new ServiceError("Failed to update incident", error, "INCIDENT_UPDATE");
  return data as Incident;
}

export function detectIncidentInText(text: string): {
  severity: "amber" | "red" | "black";
  category: string;
  confidence: number;
} | null {
  const lower = text.toLowerCase();

  // Check black first (highest priority)
  for (const trigger of INCIDENT_TRIGGER_WORDS.black) {
    if (lower.includes(trigger)) {
      const category = trigger.includes("bankrupt") || trigger.includes("liquidat") || trigger.includes("winding") ? "bankruptcy"
        : trigger.includes("pay") || trigger.includes("non-payment") ? "failure_to_pay"
        : trigger.includes("misconduct") ? "staff_misconduct"
        : trigger.includes("fraud") ? "fraud"
        : trigger.includes("hse") || trigger.includes("injury") || trigger.includes("fatality") ? "hse"
        : trigger.includes("regulat") || trigger.includes("compliance") ? "regulatory_breach"
        : trigger.includes("legal") || trigger.includes("lawsuit") ? "claim"
        : "other";
      return { severity: "black", category, confidence: 0.8 };
    }
  }

  // Check red
  for (const trigger of INCIDENT_TRIGGER_WORDS.red) {
    if (lower.includes(trigger)) {
      const category = trigger.includes("damage") ? "damage"
        : trigger.includes("claim") || trigger.includes("insurance") ? "claim"
        : trigger.includes("lost") || trigger.includes("missing") ? "lost_cargo"
        : trigger.includes("theft") || trigger.includes("stolen") ? "theft"
        : trigger.includes("fly") ? "failed_to_fly"
        : trigger.includes("temperature") || trigger.includes("cold chain") ? "temperature_breach"
        : trigger.includes("contaminat") ? "contamination"
        : trigger.includes("demurrage") ? "demurrage"
        : "other";
      return { severity: "red", category, confidence: 0.7 };
    }
  }

  // Check amber
  for (const trigger of INCIDENT_TRIGGER_WORDS.amber) {
    if (lower.includes(trigger)) {
      const category = trigger.includes("delay") || trigger.includes("late") ? "delay"
        : trigger.includes("collection") || trigger.includes("pickup") ? "failed_collection"
        : trigger.includes("rolled") ? "rolled"
        : trigger.includes("short") ? "short_shipped"
        : trigger.includes("document") ? "documentation_error"
        : trigger.includes("customs") ? "customs_hold"
        : "delay";
      return { severity: "amber", category, confidence: 0.6 };
    }
  }

  return null;
}
