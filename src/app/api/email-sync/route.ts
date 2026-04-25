import { supabase } from "@/services/base";
import { enqueue } from "@/lib/enrichment/queue";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";
import { DEFAULT_SENDER_EMAIL, isInternalEmail } from "@/config/customer";
import { getSession } from "@/lib/session";

const CLIENT_ID = process.env.AZURE_CLIENT_ID || "";
const CLIENT_SECRET = process.env.AZURE_CLIENT_SECRET || "";
const TENANT_ID = process.env.AZURE_TENANT_ID || "";

// Get app-level token (not user-delegated) for reading all mailboxes
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
      console.error("[email-sync] getAppToken: no access_token in response", data.error || data);
      return null;
    }
    return data.access_token;
  } catch (err) {
    console.error("[email-sync] getAppToken failed:", err);
    return null;
  }
}

// Fetch emails for a specific user (supports pagination via nextLink or date filter)
async function fetchUserEmails(token: string, userEmail: string, folder: string = "inbox", top: number = 250, nextLink?: string, daysBack: number = 7) {
  if (nextLink) {
    const res = await fetch(nextLink, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) return { emails: [], nextLink: null };
    const data = await res.json();
    return { emails: data.value || [], nextLink: data["@odata.nextLink"] || null };
  }

  // Filter by date - get all emails from the last N days
  const since = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000).toISOString();
  const filter = `receivedDateTime ge ${since}`;
  const url = `https://graph.microsoft.com/v1.0/users/${userEmail}/mailFolders/${folder}/messages?$top=${top}&$filter=${encodeURIComponent(filter)}&$orderby=receivedDateTime desc&$select=id,subject,bodyPreview,body,from,toRecipients,ccRecipients,receivedDateTime,isRead,hasAttachments,conversationId,internetMessageHeaders`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) return { emails: [], nextLink: null };
  const data = await res.json();
  return { emails: data.value || [], nextLink: data["@odata.nextLink"] || null };
}

// Search emails using Graph $search (searches subject, body, sender across all dates)
async function searchEmails(token: string, userEmail: string, query: string, folder: string = "inbox", top: number = 50) {
  const url = `https://graph.microsoft.com/v1.0/users/${userEmail}/mailFolders/${folder}/messages?$search="${encodeURIComponent(query)}"&$top=${top}&$select=id,subject,bodyPreview,body,from,toRecipients,ccRecipients,receivedDateTime,isRead,hasAttachments,conversationId,internetMessageHeaders`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) return [];
  const data = await res.json();
  return data.value || [];
}

// Fetch inline attachments and replace cid: references with base64
async function resolveInlineImages(token: string, userEmail: string, messageId: string, htmlBody: string): Promise<string> {
  if (!htmlBody || !htmlBody.includes("cid:")) return htmlBody;

  try {
    const res = await fetch(
      `https://graph.microsoft.com/v1.0/users/${userEmail}/messages/${messageId}/attachments?$filter=isInline eq true`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    if (!res.ok) return htmlBody;

    const data = await res.json();
    const attachments = data.value || [];

    let resolved = htmlBody;
    for (const att of attachments) {
      if (att.contentId && att.contentBytes) {
        const contentType = att.contentType || "image/png";
        const dataUrl = `data:${contentType};base64,${att.contentBytes}`;
        // Replace all cid: references for this attachment
        resolved = resolved.replace(new RegExp(`cid:${att.contentId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, "gi"), dataUrl);
      }
    }
    return resolved;
  } catch {
    return htmlBody;
  }
}

// Send email via Graph
async function sendEmail(token: string, fromEmail: string, to: string, subject: string, body: string, cc?: string) {
  const message: any = {
    subject,
    body: { contentType: "HTML", content: body.replace(/\n/g, "<br>") },
    toRecipients: [{ emailAddress: { address: to } }],
  };
  if (cc) {
    message.ccRecipients = [{ emailAddress: { address: cc } }];
  }

  const res = await fetch(`https://graph.microsoft.com/v1.0/users/${fromEmail}/sendMail`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ message, saveToSentItems: true }),
  });
  return res.ok;
}

// GET - fetch emails
export async function GET(req: Request) {
  const url = new URL(req.url);
  const userEmail = url.searchParams.get("email") || DEFAULT_SENDER_EMAIL;
  if (!isInternalEmail(userEmail)) {
    return Response.json({ error: "Invalid email" }, { status: 400 });
  }
  const folder = url.searchParams.get("folder") || "inbox";
  const top = Math.min(parseInt(url.searchParams.get("top") || "250") || 250, 500);
  const rawDays = parseInt(url.searchParams.get("days") || "7");
  const days = Number.isNaN(rawDays) ? 7 : Math.max(1, Math.min(rawDays, 90));
  const pageLink = url.searchParams.get("nextLink") || undefined;
  const searchQuery = url.searchParams.get("search") || undefined;

  if (pageLink && !pageLink.startsWith("https://graph.microsoft.com/")) {
    return Response.json({ error: "Invalid nextLink - must be a Microsoft Graph API URL" }, { status: 400 });
  }

  const token = await getAppToken();
  if (!token) return Response.json({ error: "Failed to get Graph token" }, { status: 502 });

  // If searching, use Graph $search (no date filter, searches all history)
  let emails: any[];
  let nextLink: string | null = null;
  if (searchQuery) {
    emails = await searchEmails(token, userEmail, searchQuery, folder, top);
  } else {
    const result = await fetchUserEmails(token, userEmail, folder, top, pageLink, days);
    emails = result.emails;
    nextLink = result.nextLink;
  }

  // Batch: collect all unique external emails first, then match in one query
  const allExternalEmails = new Set<string>();
  for (const email of emails) {
    const sender = email.from?.emailAddress?.address || "";
    if (sender && !isInternalEmail(sender)) allExternalEmails.add(sender);
    for (const r of (email.toRecipients || [])) {
      const addr = r.emailAddress?.address;
      if (addr && !isInternalEmail(addr)) allExternalEmails.add(addr);
    }
  }

  // Single batch query for all contacts
  const contactMap: Record<string, { account_code: string; org_name: string }> = {};
  if (allExternalEmails.size > 0) {
    const { data: contacts } = await supabase.from("cargowise_contacts")
      .select("email, account_code, org_name")
      .in("email", [...allExternalEmails].slice(0, 200));
    for (const c of (contacts || [])) {
      if (c.email) contactMap[c.email] = {
        account_code: c.account_code ?? "",
        org_name: c.org_name ?? "",
      };
    }
  }

  // Fetch blocked senders
  const { data: blockedData } = await supabase.from("email_blocked_senders").select("email_address, domain");
  const blockedEmails = new Set((blockedData || []).map((b: any) => b.email_address));
  const blockedDomains = new Set((blockedData || []).filter((b: any) => b.domain).map((b: any) => b.domain));

  // Filter out blocked senders and enrich
  const enrichedEmails = emails
    .filter((email: any) => {
      const senderEmail = (email.from?.emailAddress?.address || "").toLowerCase();
      const senderDomain = senderEmail.split("@")[1] || "";
      if (blockedEmails.has(senderEmail)) return false;
      if (senderDomain && blockedDomains.has(senderDomain)) return false;
      return true;
    })
    .map((email: any) => {
      const senderEmail = email.from?.emailAddress?.address || "";
      const recipientEmails = (email.toRecipients || []).map((r: any) => r.emailAddress?.address).filter(Boolean);
      const ccEmails = (email.ccRecipients || []).map((r: any) => r.emailAddress?.address).filter(Boolean);

      // Match from pre-fetched contacts
      let matchedAccount = contactMap[senderEmail] || null;
      if (!matchedAccount) {
        for (const re of recipientEmails) {
          if (contactMap[re]) { matchedAccount = contactMap[re]; break; }
        }
      }

      // Extract List-Unsubscribe header
      let unsubscribeUrl: string | null = null;
      const headers = email.internetMessageHeaders || [];
      for (const h of headers) {
        if (h.name?.toLowerCase() === "list-unsubscribe") {
          const urlMatch = h.value?.match(/<(https?:\/\/[^>]+)>/);
          if (urlMatch) unsubscribeUrl = urlMatch[1];
          break;
        }
      }

      return {
        id: email.id,
        subject: email.subject,
        preview: email.bodyPreview,
        body: email.body?.content || "",
        hasInlineImages: (email.body?.content || "").includes("cid:"),
        from: email.from?.emailAddress?.address || "",
        fromName: email.from?.emailAddress?.name || "",
        to: recipientEmails,
        cc: ccEmails,
        date: email.receivedDateTime,
        isRead: email.isRead,
        hasAttachments: email.hasAttachments,
        conversationId: email.conversationId,
        matchedAccount: matchedAccount?.account_code || null,
        matchedCompany: matchedAccount?.org_name || null,
        unsubscribeUrl,
      };
    });

  // Queue unknown sender domains for enrichment (non-blocking)
  queueUnknownSenders(enrichedEmails, contactMap).catch(err =>
    console.error("[email-sync] Enrichment queue error:", err)
  );

  return Response.json({ emails: enrichedEmails, nextLink: nextLink || null });
}

// Queue unknown external senders for auto-enrichment
async function queueUnknownSenders(
  emails: any[],
  contactMap: Record<string, any>,
) {
  // Collect unique external domains not in contacts
  const unknownDomains = new Set<string>();
  for (const email of emails) {
    const sender = (email.from || "").toLowerCase();
    if (!sender || isInternalEmail(sender)) continue;
    if (contactMap[sender]) continue; // Known contact
    const domain = sender.split("@")[1];
    if (domain) unknownDomains.add(domain);
  }

  if (unknownDomains.size === 0) return;

  // Batch check which domains already exist in accounts or companies
  const domains = [...unknownDomains].slice(0, 50);

  const [accountDomains, companyDomains] = await Promise.all([
    supabase.from("accounts").select("domain").in("domain", domains),
    supabase.from("companies").select("company_domain").in("company_domain", domains),
  ]);

  const knownDomains = new Set([
    ...(accountDomains.data || []).map((a: any) => a.domain),
    ...(companyDomains.data || []).map((c: any) => c.company_domain),
  ]);

  for (const domain of domains) {
    if (knownDomains.has(domain)) continue;

    try {
      // Create minimal company record and queue for enrichment
      const { data: newCompany } = await supabase
        .from("companies")
        .insert({
          company_domain: domain,
          company_name: domain.split(".")[0],
          trade_type: "unknown",
          status: "prospect",
        })
        .select("id")
        .single();

      if (newCompany) {
        await enqueue({
          entity_type: "company",
          entity_id: String(newCompany.id),
          domain,
          priority: 1,
          trigger: "email_sync",
        });
      }
    } catch (err) {
      console.error(`[email-sync] Failed to queue unknown sender domain ${domain}:`, err);
      continue;
    }
  }
}

// POST - send email
export async function POST(req: Request) {
  if (!(await checkRateLimit(getClientIp(req)))) {
    return Response.json({ error: "Too many requests" }, { status: 429 });
  }
  const { from_email, to, subject, body, cc, deal_id, account_code, reply_to_email, ai_suggested_reply } = await req.json();
  if (!to || !subject || !body) return Response.json({ error: "Missing fields" }, { status: 400 });

  const token = await getAppToken();
  if (!token) return Response.json({ error: "Failed to get Graph token" }, { status: 502 });

  const fromEmail = from_email || DEFAULT_SENDER_EMAIL;
  if (!isInternalEmail(fromEmail)) {
    return Response.json({ error: "Invalid sender" }, { status: 400 });
  }
  const success = await sendEmail(token, fromEmail, to, subject, body, cc);

  if (success) {
    // Log to deal messages if deal_id provided
    if (deal_id) {
      await supabase.from("deal_messages").insert({
        deal_id,
        type: "email_out",
        content: `**To:** ${to}\n**Subject:** ${subject}\n\n${body}`,
        sender_email: fromEmail,
      });
    }

    // Log to client_emails
    if (account_code) {
      await supabase.from("client_emails").insert({
        account_code,
        from_email: fromEmail,
        from_name: fromEmail.split("@")[0].replace(".", " "),
        to_email: to,
        subject,
        body,
        status: "sent",
      });
    }

    // Log activity
    await supabase.from("activities").insert({
      account_code: account_code || "",
      deal_id: deal_id || null,
      type: "email_sent",
      subject: `Email sent: ${subject}`,
      body: `To: ${to}`,
    });

    // Log for AI learning (if user has it enabled)
    const { data: prefs } = await supabase.from("user_preferences")
      .select("ai_learning_enabled").eq("email", fromEmail).single();
    const learningEnabled = prefs?.ai_learning_enabled !== false; // default true

    if (learningEnabled) {
      await supabase.from("ai_writing_samples").insert({
        user_email: fromEmail,
        context: reply_to_email ? "reply" : "compose",
        original_email_from: reply_to_email?.from || to,
        original_email_subject: reply_to_email?.subject || subject,
        original_email_preview: reply_to_email?.preview || "",
        ai_suggested_reply: ai_suggested_reply || null,
        actual_reply: body,
        used_suggestion: ai_suggested_reply ? body === ai_suggested_reply : false,
      }); // Log for AI learning
    }

    return Response.json({ success: true });
  }

  return Response.json({ error: "Failed to send" }, { status: 502 });
}

// PATCH - archive, delete, or change read state on an email via Graph API.
// Bulk triage (Archive 75 marketing emails in one go) routinely fires 25+
// PATCH calls in a few seconds, so authenticated callers get a per-user
// bucket with 300/min cap. Unauthenticated callers stay on the strict
// 30/min IP default - they shouldn't be hitting this anyway.
export async function PATCH(req: Request) {
  const session = await getSession();
  if (!session?.email) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }
  const rateBucket = `user:${session.email.toLowerCase()}`;
  if (!(await checkRateLimit(rateBucket, 300))) {
    return Response.json({ error: "Too many requests" }, { status: 429 });
  }

  const { email_id, user_email, action } = await req.json();
  if (!email_id || !action) return Response.json({ error: "Missing email_id or action" }, { status: 400 });
  if (/[\\]/.test(email_id)) return Response.json({ error: "Invalid email_id" }, { status: 400 });

  const token = await getAppToken();
  if (!token) return Response.json({ error: "Failed to get Graph token" }, { status: 502 });

  // Mailbox to act on: if the caller passed an internal email (shared inbox
  // case), use that. Otherwise default to the sender-shared mailbox. We do
  // NOT want to call Graph with a guest/external email - Graph won't resolve
  // those as mailboxes in this tenant.
  let userEmail = DEFAULT_SENDER_EMAIL;
  if (user_email && isInternalEmail(user_email)) {
    userEmail = user_email;
  } else if (isInternalEmail(session.email)) {
    userEmail = session.email;
  }
  // At this point userEmail is guaranteed to be an internal-domain mailbox
  // (either the explicit shared inbox, the caller's corporate address, or
  // the configured DEFAULT_SENDER_EMAIL fallback).

  if (action === "archive") {
    // Move to Archive folder
    const res = await fetch(
      `https://graph.microsoft.com/v1.0/users/${userEmail}/messages/${email_id}/move`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ destinationId: "archive" }),
      },
    );
    if (!res.ok) {
      const err = await res.text();
      console.error("[email-sync] Archive failed:", err);
      return Response.json({ error: "Failed to archive" }, { status: 502 });
    }
    return Response.json({ success: true });
  }

  if (action === "delete") {
    // Move to Deleted Items
    const res = await fetch(
      `https://graph.microsoft.com/v1.0/users/${userEmail}/messages/${email_id}/move`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ destinationId: "deleteditems" }),
      },
    );
    if (!res.ok) {
      const err = await res.text();
      console.error("[email-sync] Delete failed:", err);
      return Response.json({ error: "Failed to delete" }, { status: 502 });
    }
    return Response.json({ success: true });
  }

  if (action === "mark_read" || action === "mark_unread") {
    const isRead = action === "mark_read";
    const res = await fetch(
      `https://graph.microsoft.com/v1.0/users/${userEmail}/messages/${email_id}`,
      {
        method: "PATCH",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ isRead }),
      },
    );
    if (!res.ok) {
      const err = await res.text();
      console.error(`[email-sync] ${action} failed:`, err);
      return Response.json({ error: `Failed to ${action}` }, { status: 502 });
    }
    return Response.json({ success: true });
  }

  return Response.json({ error: "Invalid action" }, { status: 400 });
}
