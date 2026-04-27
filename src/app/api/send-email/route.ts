import { supabase } from "@/services/base";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";
import { DEFAULT_SENDER_EMAIL, isInternalEmail } from "@/config/customer";
import { getSession } from "@/lib/session";
import {
  logEvent,
  applySubjectTag,
  TENANT_ZERO_ORG_ID,
  type LogEventOutput,
} from "@/lib/activity/log-event";

const RESEND_KEY = process.env.RESEND_API_KEY || "";

// 24h SLA on outbound replies before the follow-up scheduler picks
// the conversation up. Tunable per-tenant in the future via
// core.organisations.settings.
const OUTBOUND_AWAITING_RESPONSE_HOURS = 24;

interface SendEmailPayload {
  account_code?: string;
  to?: string;
  to_name?: string;
  subject?: string;
  body?: string;
  /**
   * Optional: link the outbound to an activity subject (deal,
   * shipment, rfq, etc.). When omitted, falls back to account_code
   * (treated as `company`) or 'email_send' for standalone sends.
   */
  subject_type?: string;
  subject_id?: string;
}

interface ActivityUpdateClient {
  from(table: string): {
    update: (vals: Record<string, unknown>) => {
      eq: (col: string, val: unknown) => Promise<{ error: { message: string } | null }>;
    };
  };
}

function activityUpdateClient(): ActivityUpdateClient {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (supabase as any).schema("activity") as ActivityUpdateClient;
}

async function markEventStatus(eventId: string, status: string, metadataPatch?: Record<string, unknown>) {
  try {
    const ac = activityUpdateClient();
    const updates: Record<string, unknown> = { status };
    if (metadataPatch) updates.metadata = metadataPatch;
    const { error } = await ac.from("events").update(updates).eq("event_id", eventId);
    if (error) {
      console.error(`[send-email] failed to update event ${eventId} -> ${status}: ${error.message}`);
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown";
    console.error(`[send-email] markEventStatus threw: ${msg}`);
  }
}

export async function POST(req: Request) {
  if (!(await checkRateLimit(getClientIp(req)))) {
    return Response.json({ error: "Too many requests" }, { status: 429 });
  }

  const session = await getSession();
  if (!session?.email) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }

  if (!isInternalEmail(session.email)) {
    console.warn(`[send-email] Blocked send attempt from non-internal email: ${session.email}`);
    return Response.json({ error: "Sender not authorised" }, { status: 403 });
  }

  let payload: SendEmailPayload;
  try {
    payload = (await req.json()) as SendEmailPayload;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { account_code, to, to_name, subject, body, subject_type, subject_id } = payload;
  if (!to || !subject || !body) {
    return Response.json({ error: "Missing to, subject, or body" }, { status: 400 });
  }
  if (!RESEND_KEY) {
    console.error("[send-email] RESEND_API_KEY not configured");
    return Response.json({ error: "Email service not configured" }, { status: 500 });
  }

  const senderEmail = session.email;
  const senderName = session.name || DEFAULT_SENDER_EMAIL;

  // Resolve activity subject for the event log. Explicit subject_type +
  // subject_id wins; account_code maps to a CRM company; otherwise
  // standalone.
  const resolvedSubjectType = subject_type ?? (account_code ? "company" : "email_send");
  const resolvedSubjectId = subject_id ?? account_code ?? `${senderEmail}-${Date.now()}`;

  // Log BEFORE Resend so the correlation token can be embedded in
  // the outbound. The event lands as 'awaiting_response'; if Resend
  // fails we'll mark it 'expired' afterwards.
  let activityResult: LogEventOutput | null = null;
  try {
    activityResult = await logEvent({
      orgId: TENANT_ZERO_ORG_ID,
      eventType: "email_sent",
      direction: "outbound",
      channel: "email",
      subjectType: resolvedSubjectType,
      subjectId: resolvedSubjectId,
      title: subject,
      body,
      counterpartyType: "client",
      counterpartyEmail: to.toLowerCase(),
      status: "awaiting_response",
      awaitingResponseUntil: new Date(Date.now() + OUTBOUND_AWAITING_RESPONSE_HOURS * 60 * 60 * 1000),
      visibility: "public_to_org",
      entryKind: "external",
      createdBy: senderEmail,
      metadata: {
        email: {
          provider: "imap",
          from: { name: senderName, address: senderEmail },
          to: [{ name: to_name, address: to.toLowerCase() }],
          subjectRaw: subject,
        },
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown";
    console.error(`[send-email] logEvent failed (continuing with send): ${msg}`);
  }

  const finalSubject = applySubjectTag(subject, activityResult?.subjectTag);
  const replyTo = activityResult?.replyToAddress ?? senderEmail;

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${RESEND_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: `${senderName} <${senderEmail}>`,
        to: [to],
        subject: finalSubject,
        html: body.replace(/\n/g, "<br>"),
        reply_to: replyTo,
      }),
    });

    const data = (await res.json()) as { id?: string; message?: string };

    if (data.id) {
      // Stamp the Resend message-id onto the activity event so the
      // inbound matcher's Message-ID layer can find it. Best-effort.
      if (activityResult?.eventId) {
        try {
          const ac = activityUpdateClient();
          const { error } = await ac
            .from("events")
            .update({ email_message_id: data.id })
            .eq("event_id", activityResult.eventId);
          if (error) {
            console.error(`[send-email] failed to stamp message-id: ${error.message}`);
          }
        } catch (e) {
          const msg = e instanceof Error ? e.message : "unknown";
          console.error(`[send-email] message-id stamp threw: ${msg}`);
        }
      }

      // Legacy CRM logging (backwards compatibility with existing callers)
      if (account_code) {
        const { error: logErr } = await supabase.from("client_emails").insert({
          account_code,
          from_email: senderEmail,
          from_name: senderName,
          to_email: to,
          to_name: to_name || "",
          subject,
          body,
          resend_id: data.id,
          status: "sent",
        });
        if (logErr) {
          console.error("[send-email] Failed to log sent email:", logErr.message);
        }
      }

      return Response.json({
        success: true,
        id: data.id,
        activity_event_id: activityResult?.eventId ?? null,
        thread_id: activityResult?.threadId ?? null,
      });
    }

    // Send failed - mark the event so the timeline reflects reality
    if (activityResult?.eventId) {
      await markEventStatus(activityResult.eventId, "expired", {
        send_error: data.message ?? "send_failed",
      });
    }
    console.error("[send-email] Resend error:", data);
    return Response.json({ error: data.message || "Send failed" }, { status: 502 });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Send error";
    if (activityResult?.eventId) {
      await markEventStatus(activityResult.eventId, "expired", { send_error: msg });
    }
    console.error("[send-email] Unexpected error:", e);
    return Response.json({ error: msg }, { status: 500 });
  }
}
