import { supabase } from "@/services/base";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";
import { DEFAULT_SENDER_EMAIL, isInternalEmail } from "@/config/customer";
import { getSession } from "@/lib/session";

const RESEND_KEY = process.env.RESEND_API_KEY || "";

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

  let payload: { account_code?: string; to?: string; to_name?: string; subject?: string; body?: string };
  try {
    payload = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { account_code, to, to_name, subject, body } = payload;
  if (!to || !subject || !body) {
    return Response.json({ error: "Missing to, subject, or body" }, { status: 400 });
  }
  if (!RESEND_KEY) {
    console.error("[send-email] RESEND_API_KEY not configured");
    return Response.json({ error: "Email service not configured" }, { status: 500 });
  }

  // Sender is the authenticated user - never trust the client body for this.
  const senderEmail = session.email;
  const senderName = session.name || DEFAULT_SENDER_EMAIL;

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
        subject,
        html: body.replace(/\n/g, "<br>"),
        reply_to: senderEmail,
      }),
    });

    const data = await res.json();

    if (data.id) {
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

      return Response.json({ success: true, id: data.id });
    }

    // Log provider error server-side but do not leak full payload to caller.
    console.error("[send-email] Resend error:", data);
    return Response.json({ error: data.message || "Send failed" }, { status: 502 });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Send error";
    console.error("[send-email] Unexpected error:", e);
    return Response.json({ error: msg }, { status: 500 });
  }
}
