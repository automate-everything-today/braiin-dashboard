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

export type EmailFilter = "all" | "direct" | "action" | "cc" | "fyi" | "marketing" | "pinned" | "snoozed" | "mine" | "unassigned";

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

// Category display config: label + neutral greyscale. Categories are
// secondary triage info - stages carry the lifecycle signal and tags carry
// routing. Kept muted so stages are the loudest pill on a list card.
export const CATEGORY_CONFIG: Record<string, { label: string; bg: string; text: string }> = {
  direct: { label: "Direct", bg: "bg-zinc-100", text: "text-zinc-600" },
  action: { label: "Action", bg: "bg-zinc-200", text: "text-zinc-700" },
  cc: { label: "CC", bg: "bg-zinc-100", text: "text-zinc-500" },
  fyi: { label: "FYI", bg: "bg-zinc-50", text: "text-zinc-500" },
  marketing: { label: "Marketing", bg: "bg-zinc-100", text: "text-zinc-500" },
  internal: { label: "Internal", bg: "bg-zinc-100", text: "text-zinc-600" },
  agent_request: { label: "Agent Request", bg: "bg-zinc-100", text: "text-zinc-600" },
  quote_request: { label: "Quote Request", bg: "bg-zinc-100", text: "text-zinc-600" },
  rfq: { label: "RFQ", bg: "bg-zinc-100", text: "text-zinc-600" },
  rates: { label: "Rates", bg: "bg-zinc-100", text: "text-zinc-600" },
  recruiter: { label: "Recruiter", bg: "bg-zinc-100", text: "text-zinc-500" },
  network: { label: "Network", bg: "bg-zinc-100", text: "text-zinc-600" },
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

/**
 * True if the logged-in user's address is in the To: list.
 * Falls back to the customer's email domain when userEmail is not provided -
 * that's the old behaviour and treats every internal-addressed email as
 * "direct to me", which is wrong when a shared mailbox has multiple staff on
 * the To: line. Always pass userEmail at the call site.
 */
export function isUserInTo(email: Email, userEmail?: string): boolean {
  const list = (email.to || []).map((a) => (a || "").toLowerCase());
  if (userEmail) {
    const me = userEmail.toLowerCase();
    return list.includes(me);
  }
  return list.some((addr) => addr.includes(USER_DOMAIN));
}

export function isUserInCc(email: Email, userEmail?: string): boolean {
  const list = (email.cc || []).map((a) => (a || "").toLowerCase());
  if (userEmail) {
    const me = userEmail.toLowerCase();
    return list.includes(me);
  }
  return list.some((addr) => addr.includes(USER_DOMAIN));
}

export function isFyiEmail(email: Email): boolean {
  const fromLower = (email.from || "").toLowerCase();
  const fromDomain = fromLower.split("@")[1] || "";
  if (FYI_SENDER_PATTERNS.some(p => fromLower.includes(p))) return true;
  if (FYI_DOMAINS.some(d => fromDomain.includes(d))) return true;
  return false;
}

// Narrow set of marketing-specific indicators. FYI_SENDER_PATTERNS is broader
// (covers noreply, support@, notifications@ which aren't really marketing), so
// we use a tighter subset here for the Marketing tab heuristic fallback.
const MARKETING_SENDER_PATTERNS = [
  "newsletter", "marketing", "campaign", "promo", "offers", "deals",
  "unsubscribe",
];

const MARKETING_DOMAINS = [
  "mailchimp.com", "hubspot.com", "sendgrid.net", "mailgun.org",
  "constantcontact.com", "campaign-archive.com", "createsend.com",
  "marketo.com", "pardot.com", "sendinblue.com", "brevo.com",
  "klaviyo.com", "mailerlite.com",
];

/**
 * True if the email is marketing. Prefers the AI classification when one is
 * available (accurate). Falls back to narrow heuristics on sender patterns
 * and known marketing-tool domains (fast, works before classification runs).
 *
 * Second signal: the email carries a List-Unsubscribe header (unsubscribeUrl).
 * RFC 8058 mail only ships that header on bulk/marketing sends.
 */
export function isMarketingEmail(
  email: Email,
  classificationCategory?: string | null,
): boolean {
  if (classificationCategory === "marketing") return true;

  if (email.unsubscribeUrl) return true;

  const fromLower = (email.from || "").toLowerCase();
  const fromDomain = fromLower.split("@")[1] || "";
  if (MARKETING_SENDER_PATTERNS.some(p => fromLower.includes(p))) return true;
  if (MARKETING_DOMAINS.some(d => fromDomain.includes(d))) return true;

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
