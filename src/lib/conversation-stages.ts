/**
 * Thread lifecycle stages. Stored lowercase-snake in the DB, displayed as
 * title-case labels in the UI. The ordering below is used by the stages
 * dashboard (left-to-right pipeline) - treat it as canonical. Adding a new
 * stage requires: (a) updating this file, (b) adding it to the CHECK
 * constraint in migration 013 (or a follow-up migration), (c) adding
 * guidance to the classifier prompt so Claude knows when to emit it.
 */

export const CONVERSATION_STAGES = [
  "lead",
  "quote_request",
  "awaiting_info",
  "quote_sent",
  "quote_follow_up",
  "quote_secured",
  "booked",
  "live_shipment",
  "exception",
  "delivered",
  "invoicing",
  "paid",
  "closed",
] as const;

export type ConversationStage = (typeof CONVERSATION_STAGES)[number];

const STAGE_SET = new Set<string>(CONVERSATION_STAGES);

export const STAGE_LABEL: Record<ConversationStage, string> = {
  lead: "Lead",
  quote_request: "Quote Request",
  awaiting_info: "Awaiting Info",
  quote_sent: "Quote Sent",
  quote_follow_up: "Waiting Follow-Up",
  quote_secured: "Quote Secured",
  booked: "Booked",
  live_shipment: "Live Shipment",
  exception: "Exception",
  delivered: "Delivered",
  invoicing: "Invoicing",
  paid: "Paid",
  closed: "Closed",
};

/**
 * Short plain-English description of what the stage means. Used as a
 * tooltip on stage pills and as guidance copy on the stages dashboard.
 */
export const STAGE_DESCRIPTION: Record<ConversationStage, string> = {
  lead: "New contact with no quote or enquiry yet",
  quote_request: "Client or prospect has asked for a quote",
  awaiting_info: "We've asked them for info, waiting on response",
  quote_sent: "Quote delivered, ball in their court",
  quote_follow_up: "Chasing them on a sent quote",
  quote_secured: "They've confirmed, booking in progress",
  booked: "Shipment confirmed, not yet moving",
  live_shipment: "Cargo in transit",
  exception: "Something went wrong - delay, damage, claim, hold",
  delivered: "Arrived at destination, awaiting invoicing",
  invoicing: "In billing stage",
  paid: "Invoice settled, thread winding down",
  closed: "Thread complete, no further action",
};

/**
 * Tailwind class pairs for each stage pill. Chosen so the pipeline reads
 * left-to-right cool-to-warm: early stages are neutral/blue, active
 * shipment is purple, warnings are amber/red, completion is green.
 */
export const STAGE_STYLE: Record<ConversationStage, string> = {
  lead: "bg-zinc-100 text-zinc-700 border-zinc-200",
  quote_request: "bg-blue-50 text-blue-700 border-blue-200",
  awaiting_info: "bg-amber-50 text-amber-700 border-amber-200",
  quote_sent: "bg-sky-50 text-sky-700 border-sky-200",
  quote_follow_up: "bg-orange-50 text-orange-700 border-orange-200",
  quote_secured: "bg-indigo-50 text-indigo-700 border-indigo-200",
  booked: "bg-violet-50 text-violet-700 border-violet-200",
  live_shipment: "bg-purple-50 text-purple-700 border-purple-200",
  exception: "bg-red-50 text-red-700 border-red-200",
  delivered: "bg-teal-50 text-teal-700 border-teal-200",
  invoicing: "bg-amber-100 text-amber-800 border-amber-300",
  paid: "bg-emerald-50 text-emerald-700 border-emerald-200",
  closed: "bg-zinc-50 text-zinc-500 border-zinc-200",
};

/**
 * Typed narrowing helper for arbitrary input (e.g. DB row, API payload,
 * model output). Returns null when the value isn't a known stage so
 * callers get a single source of truth for stage validation.
 */
export function isConversationStage(value: unknown): value is ConversationStage {
  return typeof value === "string" && STAGE_SET.has(value);
}

/**
 * Coerce an arbitrary value into a conversation stage or null. Lowercases
 * and trims first so "Quote Request" or "QUOTE_REQUEST" from a model
 * output doesn't get dropped on a case mismatch.
 */
export function normaliseStage(raw: unknown): ConversationStage | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim().toLowerCase().replace(/[\s-]/g, "_");
  if (!trimmed) return null;
  return STAGE_SET.has(trimmed) ? (trimmed as ConversationStage) : null;
}
