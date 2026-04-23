// src/types/email.ts
import { CUSTOMER } from "@/config/customer";

export type Email = {
  id: string;
  subject: string;
  preview: string;
  body: string;
  from: string;
  fromName: string;
  to: string[];
  cc: string[];
  date: string;
  isRead: boolean;
  hasAttachments: boolean;
  hasInlineImages: boolean;
  conversationId: string;
  matchedAccount: string | null;
  matchedCompany: string | null;
  unsubscribeUrl: string | null;
};

export type SenderIntel = {
  isClient: boolean;
  isProspect: boolean;
  isForwarder: boolean;
  accountCode: string;
  companyName: string;
  totalJobs: number;
  totalProfit: number;
  months: number;
  lastMonth: string;
  contactCount: number;
  dealCount: number;
  commoditySummary: string;
  currentProvider: string;
  accountHealth: string;
};

export type EmailFilter = "all" | "direct" | "action" | "cc" | "fyi" | "pinned" | "snoozed" | "mine" | "unassigned";

export type TagInfo = { tag: string; party: string | null; is_primary: boolean };

export type EmailThread = {
  latest: Email;
  emails: Email[];
  count: number;
  conversationId: string;
};

// Deployment-specific customer email domain, sourced from env config.
export const USER_DOMAIN = CUSTOMER.emailDomain;

export const PARTIES = ["Client", "Carrier", "Customs", "Haulage"] as const;

export const PARTY_COLORS: Record<string, string> = {
  Client: "bg-blue-100 text-blue-700",
  Carrier: "bg-green-100 text-green-700",
  Customs: "bg-amber-100 text-amber-700",
  Haulage: "bg-purple-100 text-purple-700",
};

// Category display config: label, background colour (pastel), text colour
export const CATEGORY_CONFIG: Record<string, { label: string; bg: string; text: string }> = {
  direct: { label: "Direct", bg: "bg-blue-100", text: "text-blue-700" },
  action: { label: "Action", bg: "bg-orange-100", text: "text-orange-700" },
  cc: { label: "CC", bg: "bg-zinc-100", text: "text-zinc-600" },
  fyi: { label: "FYI", bg: "bg-zinc-100", text: "text-zinc-500" },
  marketing: { label: "Marketing", bg: "bg-pink-100", text: "text-pink-700" },
  internal: { label: "Internal", bg: "bg-indigo-100", text: "text-indigo-700" },
  agent_request: { label: "Agent Request", bg: "bg-purple-100", text: "text-purple-700" },
  quote_request: { label: "Quote Request", bg: "bg-green-100", text: "text-green-700" },
  rfq: { label: "RFQ", bg: "bg-emerald-100", text: "text-emerald-700" },
  rates: { label: "Rates", bg: "bg-cyan-100", text: "text-cyan-700" },
  recruiter: { label: "Recruiter", bg: "bg-rose-100", text: "text-rose-700" },
};

export function formatCategory(cat: string): { label: string; className: string } {
  if (!cat) return { label: "Unknown", className: "bg-zinc-100 text-zinc-600" };
  const config = CATEGORY_CONFIG[cat];
  if (config) return { label: config.label, className: `${config.bg} ${config.text}` };
  // Fallback: capitalise, replace underscores
  const label = cat.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
  return { label, className: "bg-zinc-100 text-zinc-600" };
}

export const FYI_SENDER_PATTERNS = [
  "noreply", "no-reply", "newsletter", "marketing", "info@", "updates@",
  "notifications@", "digest@", "mailer@", "news@", "alerts@", "support@",
  "donotreply", "do-not-reply",
];

export const FYI_DOMAINS = [
  "mailchimp.com", "hubspot.com", "sendgrid.net", "mailgun.org",
  "constantcontact.com", "campaign-archive.com", "createsend.com",
  "salesforce.com", "marketo.com", "pardot.com", "intercom.io",
  "sendinblue.com", "brevo.com", "klaviyo.com",
];

export function isUserInTo(email: Email): boolean {
  return (email.to || []).some(addr => (addr || "").toLowerCase().includes(USER_DOMAIN));
}

export function isUserInCc(email: Email): boolean {
  return (email.cc || []).some(addr => (addr || "").toLowerCase().includes(USER_DOMAIN));
}

export function isFyiEmail(email: Email): boolean {
  const fromLower = (email.from || "").toLowerCase();
  const fromDomain = fromLower.split("@")[1] || "";
  if (FYI_SENDER_PATTERNS.some(p => fromLower.includes(p))) return true;
  if (FYI_DOMAINS.some(d => fromDomain.includes(d))) return true;
  return false;
}

export function stripHtml(html: string): string {
  if (!html) return "";
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<img[^>]*>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<\/div>/gi, "\n")
    .replace(/<\/tr>/gi, "\n")
    .replace(/<\/li>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function detectRefs(text: string): string[] {
  if (!text) return [];
  const refs: string[] = [];
  const cwRefs = text.match(/\b[A-Z]{2}\d{8}\b/g);
  if (cwRefs) refs.push(...cwRefs);
  const containerRefs = text.match(/\b[A-Z]{4}\d{7}\b/g);
  if (containerRefs) refs.push(...containerRefs);
  const bookingRefs = text.match(/\bBK[A-Z]{0,2}[-]?\d{4,8}\b/gi);
  if (bookingRefs) refs.push(...bookingRefs.map(r => r.toUpperCase()));
  const poRefs = text.match(/\bPO[-]?\d{4,8}\b/gi);
  if (poRefs) refs.push(...poRefs.map(r => r.toUpperCase()));
  const invRefs = text.match(/\bINV[-]?\d{4,8}\b/gi);
  if (invRefs) refs.push(...invRefs.map(r => r.toUpperCase()));
  const quotedRefs = text.match(/(?:ref(?:erence)?[:\s]+)([A-Z0-9][-A-Z0-9]{4,15})/gi);
  if (quotedRefs) refs.push(...quotedRefs.map(r => r.replace(/ref(?:erence)?[:\s]+/i, "").toUpperCase()));
  return [...new Set(refs)];
}
