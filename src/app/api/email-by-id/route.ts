import { supabase } from "@/services/base";
import { getSession } from "@/lib/session";
import { isInternalEmail } from "@/config/customer";

/**
 * Fetch a single email directly from Microsoft Graph by message id.
 *
 * Used for deep-links (e.g. /email?id=... from /stages cards) so a
 * thread that isn't in the user's currently-loaded inbox / folder /
 * filter view can still be opened. The /api/email-sync GET path
 * always operates on a folder + date window; this route bypasses that
 * and fetches the specific message.
 *
 * Returns the same enriched shape the email page already consumes:
 * { id, subject, preview, body, from, fromName, to, cc, date, isRead,
 *   hasAttachments, conversationId, matchedAccount, matchedCompany }.
 *
 * Auth: same session gate as email-sync. `email` query param identifies
 * which mailbox to query Graph against; we accept either the caller's
 * own email (the common case) or any internal address (so a deep-link
 * to a shared-inbox message still resolves).
 */

const CLIENT_ID = process.env.AZURE_CLIENT_ID || "";
const CLIENT_SECRET = process.env.AZURE_CLIENT_SECRET || "";
const TENANT_ID = process.env.AZURE_TENANT_ID || "";

async function getAppToken(): Promise<string | null> {
  try {
    const res = await fetch(`https://login.microsoftonline.com/${TENANT_ID}/oauth2/v2.0/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        scope: "https://graph.microsoft.com/.default",
        grant_type: "client_credentials",
      }),
    });
    const data = await res.json();
    if (!data.access_token) {
      console.error("[email-by-id] getAppToken: no access_token", data.error || data);
      return null;
    }
    return data.access_token as string;
  } catch (err) {
    console.error("[email-by-id] getAppToken failed:", err);
    return null;
  }
}

export async function GET(req: Request) {
  const session = await getSession();
  if (!session?.email) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }

  const url = new URL(req.url);
  const id = url.searchParams.get("id") || "";
  // The Graph mailbox to query. Defaults to the caller's own mailbox.
  // Allowing an explicit `email` param lets a deep-link target a shared
  // inbox the user has access to.
  const mailbox = (url.searchParams.get("email") || session.email).toLowerCase();

  if (!id) return Response.json({ error: "id required" }, { status: 400 });
  if (!isInternalEmail(mailbox)) {
    return Response.json({ error: "Invalid mailbox" }, { status: 400 });
  }
  // Outlook message IDs are URL-safe base64; reject anything with a
  // backslash so we don't get tricked into a bad Graph URL.
  if (/[\\]/.test(id)) {
    return Response.json({ error: "Invalid id" }, { status: 400 });
  }

  const token = await getAppToken();
  if (!token) return Response.json({ error: "Failed to get Graph token" }, { status: 502 });

  const select =
    "id,subject,bodyPreview,body,from,toRecipients,ccRecipients,receivedDateTime,isRead,hasAttachments,conversationId,internetMessageHeaders";
  const graphUrl = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(mailbox)}/messages/${encodeURIComponent(id)}?$select=${select}`;
  const res = await fetch(graphUrl, { headers: { Authorization: `Bearer ${token}` } });
  if (res.status === 404) {
    return Response.json({ error: "Email not found in this mailbox" }, { status: 404 });
  }
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    console.error("[email-by-id] Graph fetch failed", res.status, txt);
    return Response.json({ error: "Failed to fetch email" }, { status: 502 });
  }
  const email = await res.json();

  // Match the same enrichment the list path performs (account_code +
  // org_name from cargowise_contacts), so the deep-linked email looks
  // identical in the UI to one loaded via the inbox list.
  const senderEmail = (email.from?.emailAddress?.address || "").toLowerCase();
  const recipientEmails: string[] = (email.toRecipients || [])
    .map((r: { emailAddress?: { address?: string } }) => r.emailAddress?.address || "")
    .filter(Boolean);
  const ccEmails: string[] = (email.ccRecipients || [])
    .map((r: { emailAddress?: { address?: string } }) => r.emailAddress?.address || "")
    .filter(Boolean);

  const candidates = [senderEmail, ...recipientEmails].filter(Boolean);
  let matchedAccount: { account_code: string; org_name: string } | null = null;
  if (candidates.length > 0) {
    const { data: contacts } = await supabase
      .from("cargowise_contacts")
      .select("email, account_code, org_name")
      .in("email", candidates.slice(0, 50));
    const byEmail = new Map<string, { account_code: string; org_name: string }>();
    for (const c of (contacts || []) as Array<{ email?: string | null; account_code?: string | null; org_name?: string | null }>) {
      if (c.email) {
        byEmail.set(c.email.toLowerCase(), {
          account_code: c.account_code ?? "",
          org_name: c.org_name ?? "",
        });
      }
    }
    matchedAccount =
      byEmail.get(senderEmail) ||
      candidates.map((e) => byEmail.get(e)).find((x) => !!x) ||
      null;
  }

  let unsubscribeUrl: string | null = null;
  for (const h of (email.internetMessageHeaders || []) as Array<{ name?: string; value?: string }>) {
    if (h.name?.toLowerCase() === "list-unsubscribe") {
      const m = h.value?.match(/<(https?:\/\/[^>]+)>/);
      if (m) unsubscribeUrl = m[1];
      break;
    }
  }

  return Response.json({
    email: {
      id: email.id,
      subject: email.subject || "",
      preview: email.bodyPreview || "",
      body: email.body?.content || "",
      hasInlineImages: (email.body?.content || "").includes("cid:"),
      from: email.from?.emailAddress?.address || "",
      fromName: email.from?.emailAddress?.name || "",
      to: recipientEmails,
      cc: ccEmails,
      date: email.receivedDateTime,
      isRead: !!email.isRead,
      hasAttachments: !!email.hasAttachments,
      conversationId: email.conversationId || null,
      matchedAccount: matchedAccount?.account_code || null,
      matchedCompany: matchedAccount?.org_name || null,
      unsubscribeUrl,
    },
    mailbox,
  });
}
