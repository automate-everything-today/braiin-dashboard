/**
 * Activity SDK - the single write path for the Stream module.
 *
 * Every module (Inbox, CRM, Rates, Quote, Pulse) calls `logEvent()`
 * to append to the activity event log. Outbound emails get a
 * correlation token minted automatically (128-bit entropy, three
 * layers) so inbound replies can be stitched back to the same
 * subject - see the inbound webhook handler.
 *
 * Server-only. The activity schema is service-role gated; the
 * Supabase client this module imports is the runtime-dispatched one
 * from @/services/base which uses the service role key on the
 * server. Do not call from the browser.
 */

import { randomBytes } from "node:crypto";
import { supabase } from "@/services/base";

const INBOUND_DOMAIN = process.env.INBOUND_EMAIL_DOMAIN || "inbound.braiin.app";

// ============================================================
// Public types
// ============================================================

export type ActivityEventType =
  | "email_sent" | "email_received" | "email_bounced" | "email_replied"
  | "phone_call" | "meeting" | "sms_sent" | "sms_received"
  | "manual_note"
  | "rfq_drafted" | "rfq_sent" | "rfq_acknowledged"
  | "rate_indicated" | "rate_firm_quoted" | "rate_subject_to"
  | "rate_validity_expiring" | "rate_validity_expired"
  | "rfq_awarded" | "rfq_lost"
  | "quote_sent" | "quote_accepted" | "quote_rejected" | "quote_expired"
  | "counter_offer_sent" | "counter_offer_received"
  | "booking_placed" | "booking_confirmed" | "booking_partial"
  | "s_o_issued" | "vgm_submitted" | "si_submitted"
  | "cargo_ready" | "gate_in" | "loaded_on_board"
  | "vessel_departed" | "vessel_arrived"
  | "transhipment_connected" | "transhipment_missed"
  | "rollover_notified" | "shutout"
  | "draft_bl_received" | "draft_bl_approved"
  | "obl_courier_dispatched" | "obl_received"
  | "telex_release_received" | "switch_bl_issued"
  | "document_mismatch_detected"
  | "customs_lodged" | "customs_query" | "customs_held"
  | "customs_inspection_scheduled" | "customs_released" | "customs_seized"
  | "sanctions_block" | "dg_declaration_filed" | "dg_declaration_rejected"
  | "hs_classification_changed"
  | "free_time_started" | "free_time_warning" | "free_time_expired"
  | "demurrage_accruing" | "detention_accruing"
  | "storage_accruing" | "invoice_query_raised"
  | "exception_raised" | "exception_resolved"
  | "claim_filed" | "claim_acknowledged" | "claim_settled" | "claim_rejected"
  | "temperature_excursion" | "damage_reported" | "loss_reported"
  | "status_changed" | "owner_assigned"
  | "task_created" | "task_completed" | "task_assigned" | "task_due_changed" | "task_reopened"
  | "follow_up_scheduled" | "follow_up_fired"
  | "integration_sync" | "ai_inference" | "webhook_received";

export type ActivityDirection = "inbound" | "outbound" | "internal" | "system";
export type ActivityChannel = "email" | "phone" | "sms" | "meeting" | "portal" | "edi" | "system" | "manual";
export type ActivityVisibility = "public_to_org" | "restricted_to_owner_chain" | "manager_plus" | "directors_plus";
export type ActivityResponsibility = "carrier" | "client" | "internal" | "third_party" | "force_majeure" | "unknown";
export type ActivityEventStatus = "recorded" | "awaiting_response" | "committed" | "acknowledged" | "response_received" | "expired" | "completed" | "escalated";
export type ActivityEntryKind = "external" | "internal_comment" | "draft";

export type EmailProvider = "outlook" | "gmail" | "imap";

export interface EmailMetadata {
  provider: EmailProvider;
  messageId?: string;
  inReplyTo?: string;
  references?: string[];
  from?: { name?: string; address: string };
  to?: { name?: string; address: string }[];
  cc?: { name?: string; address: string }[];
  bcc?: { name?: string; address: string }[];
  subjectRaw?: string;
  subjectNormalised?: string;
  headers?: Record<string, string>;
  missingParticipants?: string[];
}

export interface AttachmentRef {
  name: string;
  url?: string;
  contentHash?: string;
  mime?: string;
  sizeBytes?: number;
}

export interface LogEventInput {
  orgId: string;
  branchId?: string;
  eventType: ActivityEventType;
  direction: ActivityDirection;
  channel: ActivityChannel;
  subjectType: string;
  subjectId: string;
  secondaryRef?: string;
  counterpartyType?: "carrier" | "client" | "staff" | "third_party";
  counterpartyId?: string;
  counterpartyEmail?: string;
  title: string;
  body?: string;
  bodyHtml?: string;
  attachments?: AttachmentRef[];
  metadata?: Record<string, unknown> & { email?: EmailMetadata };
  status?: ActivityEventStatus;
  awaitingResponseUntil?: Date;
  responseEventId?: string;
  visibility?: ActivityVisibility;
  responsibility?: ActivityResponsibility;
  isPinned?: boolean;
  threadId?: string;
  parentEventId?: string;
  emailMessageId?: string;
  emailInReplyTo?: string;
  entryKind?: ActivityEntryKind;
  createdBy: string;
  occurredAt?: Date;
  additionalLinks?: { subjectType: string; subjectId: string; linkRole?: string }[];
  mintCorrelationToken?: boolean;
  correlationPrefix?: string;
}

export interface LogEventOutput {
  eventId: string;
  threadId: string;
  replyToAddress?: string;
  subjectTag?: string;
  correlationKey?: string;
}

// ============================================================
// Correlation token
// ============================================================

const ENTITY_PREFIX_MAP: Record<string, string> = {
  rfq: "rfq",
  quote: "qte",
  shipment: "shp",
  deal: "dl",
  rate_card: "rc",
  client_profile: "clt",
  task: "tsk",
};

function entityPrefix(subjectType: string, override?: string): string {
  if (override) return sanitizePrefix(override);
  const mapped = ENTITY_PREFIX_MAP[subjectType];
  if (mapped) return mapped;
  return sanitizePrefix(subjectType.slice(0, 3));
}

function sanitizePrefix(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 4) || "x";
}

function mintToken(subjectType: string, override?: string): string {
  const prefix = entityPrefix(subjectType, override);
  const random = randomBytes(16).toString("base64url");
  return `${prefix}-${random}`;
}

// ============================================================
// Schema-qualified Supabase client (cross-schema escape hatch)
//
// The activity.* tables aren't yet in the generated Database type.
// Once the regen script runs we can drop the casts. Until then,
// confine the `any` to this single helper so the rest of the SDK
// stays typed.
// ============================================================

interface ActivityClient {
  from(table: string): {
    select: (cols: string) => {
      eq: (col: string, val: unknown) => ActivityChain;
    };
    insert: (row: object | object[]) => {
      select: (cols: string) => {
        single: () => Promise<{ data: Record<string, string> | null; error: { message: string } | null }>;
      };
    } & Promise<{ error: { message: string } | null }>;
  };
}

interface ActivityChain {
  eq: (col: string, val: unknown) => ActivityChain;
  order: (col: string, opts: { ascending: boolean }) => ActivityChain;
  limit: (n: number) => ActivityChain;
  maybeSingle: () => Promise<{ data: Record<string, string> | null; error: { message: string } | null }>;
}

function activityClient(): ActivityClient {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (supabase as any).schema("activity") as ActivityClient;
}

// ============================================================
// Thread management
// ============================================================

async function findOrCreateThread(
  orgId: string,
  subjectType: string,
  subjectId: string,
  fallbackTitle: string,
): Promise<string> {
  const ac = activityClient();

  const lookup = await ac
    .from("communication_threads")
    .select("thread_id")
    .eq("org_id", orgId)
    .eq("subject_type", subjectType)
    .eq("subject_id", subjectId)
    .eq("is_open", true)
    .order("last_event_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (lookup.error) {
    throw new Error(`activity.findOrCreateThread lookup failed: ${lookup.error.message}`);
  }
  if (lookup.data?.thread_id) return lookup.data.thread_id;

  const insert = await ac
    .from("communication_threads")
    .insert({
      org_id: orgId,
      subject_type: subjectType,
      subject_id: subjectId,
      title: fallbackTitle,
      is_open: true,
    })
    .select("thread_id")
    .single();

  if (insert.error || !insert.data?.thread_id) {
    throw new Error(`activity.findOrCreateThread insert failed: ${insert.error?.message ?? "no row returned"}`);
  }
  return insert.data.thread_id;
}

// ============================================================
// logEvent - the public entry point
// ============================================================

export async function logEvent(input: LogEventInput): Promise<LogEventOutput> {
  if (!input.orgId) throw new Error("logEvent: orgId is required");
  if (!input.subjectType || !input.subjectId) {
    throw new Error("logEvent: subjectType and subjectId are required (polymorphic linking)");
  }
  if (!input.title) throw new Error("logEvent: title is required");
  if (!input.createdBy) throw new Error("logEvent: createdBy is required");

  const threadId = input.threadId ?? (await findOrCreateThread(
    input.orgId,
    input.subjectType,
    input.subjectId,
    input.title,
  ));

  const shouldMint = input.mintCorrelationToken
    ?? (input.direction === "outbound" && input.channel === "email");
  const correlationKey = shouldMint
    ? mintToken(input.subjectType, input.correlationPrefix)
    : undefined;

  const occurredAt = (input.occurredAt ?? new Date()).toISOString();

  const row: Record<string, unknown> = {
    org_id: input.orgId,
    branch_id: input.branchId ?? null,
    occurred_at: occurredAt,
    event_type: input.eventType,
    direction: input.direction,
    channel: input.channel,
    subject_type: input.subjectType,
    subject_id: input.subjectId,
    secondary_ref: input.secondaryRef ?? null,
    correlation_key: correlationKey ?? null,
    counterparty_type: input.counterpartyType ?? null,
    counterparty_id: input.counterpartyId ?? null,
    counterparty_email: input.counterpartyEmail ?? null,
    title: input.title,
    body: input.body ?? null,
    body_html: input.bodyHtml ?? null,
    attachments: input.attachments ?? [],
    metadata: input.metadata ?? {},
    status: input.status ?? (input.awaitingResponseUntil ? "awaiting_response" : "recorded"),
    awaiting_response_until: input.awaitingResponseUntil?.toISOString() ?? null,
    response_event_id: input.responseEventId ?? null,
    visibility: input.visibility ?? "public_to_org",
    responsibility: input.responsibility ?? null,
    is_pinned: input.isPinned ?? false,
    thread_id: threadId,
    parent_event_id: input.parentEventId ?? null,
    email_message_id: input.emailMessageId ?? null,
    email_in_reply_to: input.emailInReplyTo ?? null,
    entry_kind: input.entryKind ?? "external",
    created_by: input.createdBy,
  };

  const ac = activityClient();
  const inserted = await ac
    .from("events")
    .insert(row)
    .select("event_id, occurred_at")
    .single();

  if (inserted.error || !inserted.data?.event_id) {
    throw new Error(`activity.logEvent insert failed: ${inserted.error?.message ?? "no row returned"}`);
  }
  const eventId = inserted.data.event_id;

  if (correlationKey) {
    const tokenInsert = await ac
      .from("outbound_correlation_tokens")
      .insert({
        token: correlationKey,
        org_id: input.orgId,
        subject_type: input.subjectType,
        subject_id: input.subjectId,
        minted_by_event_id: eventId,
      });
    if (tokenInsert.error) {
      console.error(`[activity.logEvent] correlation token persist failed for event ${eventId}: ${tokenInsert.error.message}`);
    }
  }

  if (input.additionalLinks?.length) {
    const linkRows = input.additionalLinks.map((l) => ({
      event_id: eventId,
      org_id: input.orgId,
      subject_type: l.subjectType,
      subject_id: l.subjectId,
      link_role: l.linkRole ?? null,
    }));
    const linkInsert = await ac.from("event_links").insert(linkRows);
    if (linkInsert.error) {
      console.error(`[activity.logEvent] event_links persist failed for event ${eventId}: ${linkInsert.error.message}`);
    }
  }

  return {
    eventId,
    threadId,
    correlationKey,
    replyToAddress: correlationKey ? `inbound+${correlationKey}@${INBOUND_DOMAIN}` : undefined,
    subjectTag: correlationKey ? `[Braiin Ref: ${correlationKey}]` : undefined,
  };
}

// ============================================================
// Helpers for callers
// ============================================================

/**
 * Apply correlation key embellishment to an outbound email subject
 * line. Idempotent: if the subject already contains a `[Braiin Ref: ...]`
 * marker, it is preserved and not duplicated.
 */
export function applySubjectTag(subject: string, subjectTag: string | undefined): string {
  if (!subjectTag) return subject;
  if (/\[Braiin Ref: [^\]]+\]/.test(subject)) return subject;
  return `${subject} ${subjectTag}`;
}

/**
 * Extract a Braiin reference token from an inbound subject line.
 */
export function extractSubjectToken(subject: string): string | null {
  const match = /\[Braiin Ref: ([^\]]+)\]/.exec(subject);
  return match?.[1]?.trim() ?? null;
}

/**
 * Parse `inbound+<token>@inbound.braiin.app` into the token, or null.
 */
export function extractRecipientToken(recipient: string): string | null {
  const match = /^inbound\+([^@]+)@/i.exec(recipient.trim());
  return match?.[1] ?? null;
}
