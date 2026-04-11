import { createClient } from "@supabase/supabase-js";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";
import { DEFAULT_SENDER_EMAIL } from "@/config/customer";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

const RESEND_KEY = process.env.RESEND_API_KEY || "";

export async function POST(req: Request) {
  if (!checkRateLimit(getClientIp(req))) {
    return Response.json({ error: "Too many requests" }, { status: 429 });
  }
  const { account_code, to, to_name, subject, body, from_email, from_name } = await req.json();
  if (!to || !subject || !body) {
    return Response.json({ error: "Missing to, subject, or body" }, { status: 400 });
  }
  if (!RESEND_KEY) {
    return Response.json({ error: "No Resend API key configured" }, { status: 500 });
  }

  const senderEmail = from_email || DEFAULT_SENDER_EMAIL;
  const senderName = from_name || process.env.DEFAULT_SENDER_NAME || "Support";

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
      // Log the email
      if (account_code) {
        await supabase.from("client_emails").insert({
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
      }

      return Response.json({ success: true, id: data.id });
    } else {
      return Response.json({ error: data.message || "Send failed", details: data }, { status: 502 });
    }
  } catch (e: any) {
    return Response.json({ error: e.message || "Send error" }, { status: 500 });
  }
}
