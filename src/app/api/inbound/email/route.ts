/**
 * Inbound email webhook - matcher half of the three-layer
 * correlation system.
 *
 * Configured as the destination for an inbound email service
 * (CloudMailin / Resend Inbound / SendGrid Inbound Parse / Mailgun
 * Routes - all post a similar JSON payload). The DNS MX record
 * for the inbound subdomain routes mail to that service, which
 * then POSTs here.
 *
 * Match precedence (most specific to least):
 *   1. Reply-To envelope token: inbound+<token>@<domain>
 *      (carriers can't strip the envelope; highest confidence)
 *   2. Subject-line token: [Braiin Ref: <token>]
 *   3. Message-ID / In-Reply-To header threading
 *   4. Fuzzy fallback - logged as orphan_inbound for human review
 *
 * Auth: shared secret accepted as either
 *   `Authorization: Bearer <INBOUND_WEBHOOK_SECRET>` or
 *   `Authorization: Basic <base64("braiin:<INBOUND_WEBHOOK_SECRET>")>`.
 * Basic exists because CloudMailin Free only supports HTTP Basic on
 * the target; Bearer stays for any future inbound source that supports
 * custom headers (Resend Inbound, SendGrid Inbound Parse, Mailgun Routes).
 */

import { supabase } from "@/services/base";
import { logEvent, TENANT_ZERO_ORG_ID, type EmailMetadata } from "@/lib/activity/log-event";

const WEBHOOK_SECRET = process.env.INBOUND_WEBHOOK_SECRET;

interface InboundPayload {
  envelope?: { to?: string; from?: string; recipients?: string[] };
  headers?: Record<string, string | string[]>;
  plain?: string;
  html?: string;
  reply_plain?: string;
  attachments?: { content?: string; file_name?: string; content_type?: string; size?: number; url?: string }[];
}

interface ActivityRecord {
  token?: string;
  subject_type?: string;
  subject_id?: string;
  org_id?: string;
}

interface ActivitySimpleClient {
  from(table: string): {
    select: (cols: string) => {
      eq: (c: string, v: unknown) => {
        eq: (c: string, v: unknown) => Promise<{ data: ActivityRecord[] | null; error: { message: string } | null }>;
        maybeSingle: () => Promise<{ data: ActivityRecord | null; error: { message: string } | null }>;
      };
    };
    update: (vals: Record<string, unknown>) => {
      eq: (c: string, v: unknown) => Promise<{ error: { message: string } | null }>;
    };
  };
}

function activityClient(): ActivitySimpleClient {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (supabase as any).schema("activity") as ActivitySimpleClient;
}

function pickHeader(headers: Record<string, string | string[]> | undefined, name: string): string | undefined {
  if (!headers) return undefined;
  for (const [k, v] of Object.entries(headers)) {
    if (k.toLowerCase() === name.toLowerCase()) {
      return Array.isArray(v) ? v[0] : v;
    }
  }
  return undefined;
}

function parseAddress(value: string | undefined): { name?: string; address: string } | undefined {
  if (!value) return undefined;
  const angle = /^(?:"?([^"<]*)"?\s*)?<([^>]+)>$/.exec(value.trim());
  if (angle) return { name: angle[1]?.trim() || undefined, address: angle[2].trim().toLowerCase() };
  const bare = value.trim();
  if (!bare.includes("@")) return undefined;
  return { address: bare.toLowerCase() };
}

function parseAddressList(value: string | undefined): { name?: string; address: string }[] {
  if (!value) return [];
  return value
    .split(",")
    .map((part) => parseAddress(part.trim()))
    .filter((x): x is { name?: string; address: string } => Boolean(x));
}

function normaliseSubject(subject: string | undefined): string {
  if (!subject) return "";
  return subject
    .replace(/\[Braiin Ref: [^\]]+\]/g, "")
    .replace(/^(re:|fwd?:|aw:|sv:)\s*/gi, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function parseReferences(value: string | undefined): string[] {
  if (!value) return [];
  return Array.from(value.matchAll(/<([^>]+)>/g)).map((m) => m[1]);
}

function extractRecipientToken(recipient: string | undefined): string | null {
  if (!recipient) return null;
  const match = /^inbound\+([^@]+)@/i.exec(recipient.trim());
  return match?.[1] ?? null;
}

function extractSubjectToken(subject: string | undefined): string | null {
  if (!subject) return null;
  const match = /\[Braiin Ref: ([^\]]+)\]/.exec(subject);
  return match?.[1]?.trim() ?? null;
}

interface MatchedToken {
  token: string;
  orgId: string;
  subjectType: string;
  subjectId: string;
  matchedBy: "reply_to" | "subject_tag" | "message_id";
}

async function lookupToken(token: string, matchedBy: "reply_to" | "subject_tag"): Promise<MatchedToken | null> {
  const ac = activityClient();
  const { data, error } = await ac
    .from("outbound_correlation_tokens")
    .select("token, org_id, subject_type, subject_id")
    .eq("token", token)
    .maybeSingle();

  if (error) {
    console.error(`[inbound/email] token lookup failed for ${token}: ${error.message}`);
    return null;
  }
  if (!data?.token) return null;

  return {
    token: data.token,
    orgId: data.org_id ?? "",
    subjectType: data.subject_type ?? "",
    subjectId: data.subject_id ?? "",
    matchedBy,
  };
}

async function lookupByMessageId(orgId: string, inReplyTo: string | undefined, references: string[]): Promise<MatchedToken | null> {
  const ac = activityClient();
  const candidates = [inReplyTo, ...references].filter((m): m is string => Boolean(m));
  if (!candidates.length) return null;

  for (const messageId of candidates) {
    const { data, error } = await ac
      .from("events")
      .select("subject_type, subject_id, org_id")
      .eq("org_id", orgId)
      .eq("email_message_id", messageId);
    if (error) {
      console.error(`[inbound/email] message-id lookup failed for ${messageId}: ${error.message}`);
      continue;
    }
    if (data && data.length > 0) {
      const hit = data[0];
      return {
        token: messageId,
        orgId: hit.org_id ?? orgId,
        subjectType: hit.subject_type ?? "",
        subjectId: hit.subject_id ?? "",
        matchedBy: "message_id",
      };
    }
  }
  return null;
}

function buildEmailMetadata(
  payload: InboundPayload,
  fromAddress: { name?: string; address: string } | undefined,
  subjectRaw: string,
  messageId: string | undefined,
  inReplyTo: string | undefined,
  references: string[],
): Record<string, unknown> {
  const headers = payload.headers ?? {};
  const flatHeaders: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    flatHeaders[k] = Array.isArray(v) ? v.join(", ") : v;
  }

  const email: EmailMetadata = {
    provider: "imap",
    messageId,
    inReplyTo,
    references,
    from: fromAddress,
    to: parseAddressList(pickHeader(payload.headers, "To")),
    cc: parseAddressList(pickHeader(payload.headers, "Cc")),
    bcc: parseAddressList(pickHeader(payload.headers, "Bcc")),
    subjectRaw,
    subjectNormalised: normaliseSubject(subjectRaw),
    headers: flatHeaders,
  };

  return { email };
}

export async function POST(req: Request) {
  if (!WEBHOOK_SECRET) {
    console.error("[inbound/email] INBOUND_WEBHOOK_SECRET is not configured");
    return Response.json({ error: "Inbound webhook not configured" }, { status: 500 });
  }

  const auth = req.headers.get("authorization") ?? "";
  const expectedBearer = `Bearer ${WEBHOOK_SECRET}`;
  const expectedBasic = `Basic ${Buffer.from(`braiin:${WEBHOOK_SECRET}`).toString("base64")}`;
  if (auth !== expectedBearer && auth !== expectedBasic) {
    console.warn("[inbound/email] rejected: bad auth");
    return Response.json({ error: "Unauthorised" }, { status: 401 });
  }

  let payload: InboundPayload;
  try {
    payload = (await req.json()) as InboundPayload;
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const headers = payload.headers;
  const recipient = payload.envelope?.to ?? pickHeader(headers, "To");
  const fromHeader = pickHeader(headers, "From");
  const fromAddress = parseAddress(fromHeader);
  const subject = pickHeader(headers, "Subject") ?? "";
  const messageId = pickHeader(headers, "Message-ID");
  const inReplyTo = pickHeader(headers, "In-Reply-To");
  const references = parseReferences(pickHeader(headers, "References"));

  let matched: MatchedToken | null = null;
  const recipientToken = extractRecipientToken(recipient);
  if (recipientToken) {
    matched = await lookupToken(recipientToken, "reply_to");
  }

  if (!matched) {
    const subjectToken = extractSubjectToken(subject);
    if (subjectToken) {
      matched = await lookupToken(subjectToken, "subject_tag");
    }
  }

  if (!matched && (inReplyTo || references.length)) {
    matched = await lookupByMessageId(TENANT_ZERO_ORG_ID, inReplyTo, references);
  }

  const attachmentsForLog = payload.attachments?.map((a) => ({
    name: a.file_name ?? "attachment",
    url: a.url,
    mime: a.content_type,
    sizeBytes: a.size,
  }));
  const metadataForLog = buildEmailMetadata(payload, fromAddress, subject, messageId, inReplyTo, references);

  if (!matched) {
    await logEvent({
      orgId: TENANT_ZERO_ORG_ID,
      eventType: "email_received",
      direction: "inbound",
      channel: "email",
      subjectType: "orphan_inbound",
      subjectId: messageId ?? `orphan-${Date.now()}`,
      title: subject || "(no subject)",
      body: payload.plain,
      bodyHtml: payload.html,
      counterpartyType: fromAddress ? "carrier" : undefined,
      counterpartyEmail: fromAddress?.address,
      emailMessageId: messageId,
      emailInReplyTo: inReplyTo,
      attachments: attachmentsForLog,
      metadata: metadataForLog,
      mintCorrelationToken: false,
      createdBy: "INBOUND_WEBHOOK",
    }).catch((err) => {
      console.error(`[inbound/email] failed to log orphan inbound: ${err.message}`);
    });

    return Response.json({ ok: true, matched: false, reason: "no_correlation" }, { status: 200 });
  }

  try {
    const result = await logEvent({
      orgId: matched.orgId,
      eventType: "email_received",
      direction: "inbound",
      channel: "email",
      subjectType: matched.subjectType,
      subjectId: matched.subjectId,
      title: subject || "(no subject)",
      body: payload.plain,
      bodyHtml: payload.html,
      counterpartyType: fromAddress ? "carrier" : undefined,
      counterpartyEmail: fromAddress?.address,
      emailMessageId: messageId,
      emailInReplyTo: inReplyTo,
      attachments: attachmentsForLog,
      metadata: metadataForLog,
      mintCorrelationToken: false,
      createdBy: "INBOUND_WEBHOOK",
    });

    if (matched.matchedBy !== "message_id") {
      const ac = activityClient();
      await ac
        .from("outbound_correlation_tokens")
        .update({ match_count: 1, last_matched_at: new Date().toISOString() })
        .eq("token", matched.token);
    }

    return Response.json({
      ok: true,
      matched: true,
      via: matched.matchedBy,
      event_id: result.eventId,
      thread_id: result.threadId,
    }, { status: 200 });
  } catch (err) {
    console.error(`[inbound/email] log inbound failed: ${err instanceof Error ? err.message : err}`);
    return Response.json({ error: "Failed to record inbound" }, { status: 500 });
  }
}
