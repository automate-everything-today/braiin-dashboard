/**
 * Microsoft Graph send-as adapter for event follow-ups.
 *
 * Uses the existing client-credentials flow (AZURE_CLIENT_ID / SECRET / TENANT_ID
 * from email-sync). The Graph app already has Mail.Read tenant-wide; this
 * adds Mail.Send. The same getAppToken() approach lets us send AS any tenant
 * user (Rob / Sam / Bruna) without per-user OAuth.
 *
 * Permission required (one-time Azure AD admin consent):
 *   Microsoft Graph -> Application -> Mail.Send
 *
 * Endpoint: POST /users/{senderEmail}/sendMail
 *
 * Behaviour:
 *   - Sends the message immediately (no Drafts step). The dashboard preview
 *     IS the operator's review gate.
 *   - On send, Graph stores the message in the rep's Sent Items automatically.
 *   - Returns the message id so we can persist it on event_contacts.sent_message_id
 *     and surface threading later.
 *   - Failures are surfaced loud (caller catches + flips status to 'bounced').
 *
 * Bounces / NDRs:
 *   Outlook/Exchange returns 202 on accept, then bounces arrive as inbound mail
 *   from postmaster. Bounce detection lives in a separate scanner job, not this
 *   send path. (TODO: scanner cron in a follow-up phase.)
 */

const TOKEN_URL = (tenantId: string) =>
  `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`;
const GRAPH_BASE = "https://graph.microsoft.com/v1.0";

interface GraphTokenResponse {
  access_token?: string;
  error?: string;
  error_description?: string;
}

interface AzureCreds {
  clientId: string;
  clientSecret: string;
  tenantId: string;
}

function readCreds(): AzureCreds {
  const clientId = process.env.AZURE_CLIENT_ID;
  const clientSecret = process.env.AZURE_CLIENT_SECRET;
  const tenantId = process.env.AZURE_TENANT_ID;
  if (!clientId || !clientSecret || !tenantId) {
    throw new Error(
      "Azure Graph creds missing (AZURE_CLIENT_ID, AZURE_CLIENT_SECRET, AZURE_TENANT_ID).",
    );
  }
  return { clientId, clientSecret, tenantId };
}

async function getAppToken(): Promise<string> {
  const { clientId, clientSecret, tenantId } = readCreds();
  const res = await fetch(TOKEN_URL(tenantId), {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      scope: "https://graph.microsoft.com/.default",
      grant_type: "client_credentials",
    }),
  });
  const data = (await res.json()) as GraphTokenResponse;
  if (!res.ok || !data.access_token) {
    throw new Error(
      `Graph token fetch failed: ${data.error_description ?? data.error ?? res.status}`,
    );
  }
  return data.access_token;
}

export interface SendInput {
  /** Sender mailbox - must be a tenant user (rob/sam/bruna). */
  fromEmail: string;
  /** Primary recipient. */
  toEmail: string;
  toName?: string | null;
  /** Optional CC list (Internal CC + any others). */
  ccEmails?: string[];
  subject: string;
  /** Plain text body. Graph converts to HTML automatically. */
  body: string;
  /** Optional reply-to override (rare; defaults to fromEmail). */
  replyTo?: string;
}

export interface SendResult {
  /** Microsoft Graph message id - useful for threading and debugging. */
  messageId: string;
  /** Conversation id on the sender side - links to the thread. */
  conversationId: string | null;
  /** ISO timestamp the send was accepted. */
  sentAt: string;
}

/**
 * Send an email AS the given sender. Caller is responsible for any pre-send
 * lint / approval - this is a thin wrapper.
 *
 * Plain text body is wrapped to HTML by Graph if contentType=Text. We use Text
 * here because the LLM produces plain text and we want to preserve line breaks
 * exactly as drafted, not have HTML mangle them.
 */
export async function sendViaGraph(input: SendInput): Promise<SendResult> {
  const token = await getAppToken();

  const message = {
    subject: input.subject,
    body: {
      contentType: "Text",
      content: input.body,
    },
    toRecipients: [
      {
        emailAddress: {
          address: input.toEmail,
          name: input.toName ?? undefined,
        },
      },
    ],
    ccRecipients: (input.ccEmails ?? []).map((email) => ({
      emailAddress: { address: email },
    })),
    replyTo: input.replyTo
      ? [{ emailAddress: { address: input.replyTo } }]
      : undefined,
  };

  // Graph's sendMail endpoint accepts the message + a saveToSentItems flag.
  // We DO want it in Sent Items so the rep sees their own send + so the
  // already-engaged scanner picks it up later.
  //
  // Graph sendMail returns 202 Accepted with NO body and NO message id.
  // To get the message id back we'd have to: (a) create as draft, (b) read
  // the draft id, (c) send the draft. Two extra round-trips per send. For
  // 400 contacts that's 800 extra calls.
  //
  // Compromise: send via /sendMail (single call) but search Sent Items
  // immediately after by InternetMessageId-like marker (subject + recipient
  // + within 30s) to fish out the id we need to track. Simpler: skip the id
  // for v1 and rely on the conversationId that comes back via webhook /
  // inbound reply tracking. We persist a synthetic id (timestamp-based) so
  // the row has SOMETHING for traceability.

  const res = await fetch(
    `${GRAPH_BASE}/users/${encodeURIComponent(input.fromEmail)}/sendMail`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ message, saveToSentItems: true }),
    },
  );

  if (!res.ok) {
    const text = await res.text();
    throw new Error(
      `Graph sendMail failed (${res.status}) for ${input.fromEmail} -> ${input.toEmail}: ${text.slice(0, 500)}`,
    );
  }

  // Try to fetch the most recent sent message to capture the real id +
  // conversationId. Best effort - if it fails we still return a synthetic id.
  const sentAt = new Date().toISOString();
  let messageId = `sent-${Date.now()}`;
  let conversationId: string | null = null;

  try {
    const sentItemsUrl = `${GRAPH_BASE}/users/${encodeURIComponent(input.fromEmail)}/mailFolders/SentItems/messages?$top=1&$orderby=sentDateTime desc&$select=id,subject,toRecipients,conversationId,sentDateTime`;
    const sentRes = await fetch(sentItemsUrl, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (sentRes.ok) {
      const sentData = (await sentRes.json()) as {
        value?: Array<{
          id: string;
          subject: string;
          toRecipients: Array<{ emailAddress: { address: string } }>;
          conversationId: string;
        }>;
      };
      const top = sentData.value?.[0];
      if (
        top &&
        top.subject === input.subject &&
        top.toRecipients?.[0]?.emailAddress?.address?.toLowerCase() ===
          input.toEmail.toLowerCase()
      ) {
        messageId = top.id;
        conversationId = top.conversationId ?? null;
      }
    }
  } catch {
    // Non-fatal - synthetic id remains.
  }

  return { messageId, conversationId, sentAt };
}
