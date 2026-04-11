import { DEFAULT_SENDER_EMAIL, isInternalEmail } from "@/config/customer";

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
    return data.access_token || null;
  } catch {
    return null;
  }
}

// POST - resolve inline images and return all attachments
export async function POST(req: Request) {
  const { messageId, email: userEmailParam, body } = await req.json();
  const userEmail = userEmailParam || DEFAULT_SENDER_EMAIL;
  if (!isInternalEmail(userEmail)) {
    return Response.json({ error: "Invalid email" }, { status: 400 });
  }

  if (!messageId) return Response.json({ error: "Missing messageId" }, { status: 400 });

  const token = await getAppToken();
  if (!token) return Response.json({ error: "No token" }, { status: 502 });

  try {
    // Fetch ALL attachments (both inline and regular)
    const res = await fetch(
      `https://graph.microsoft.com/v1.0/users/${userEmail}/messages/${messageId}/attachments`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    if (!res.ok) return Response.json({ body: body || "", attachments: [] });

    const data = await res.json();
    const allAttachments = data.value || [];

    // Resolve inline images in HTML body
    let resolved = body || "";
    const regularAttachments: any[] = [];

    for (const att of allAttachments) {
      if (att.isInline && att.contentId && att.contentBytes) {
        // Inline image - replace cid: reference
        const contentType = att.contentType || "image/png";
        const dataUrl = `data:${contentType};base64,${att.contentBytes}`;
        resolved = resolved.replace(
          new RegExp(`cid:${att.contentId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, "gi"),
          dataUrl
        );
      } else if (!att.isInline || !att.contentId) {
        // Regular attachment - return metadata
        regularAttachments.push({
          id: att.id,
          name: att.name,
          contentType: att.contentType,
          size: att.size,
          // Include base64 data for small files (< 1MB), just metadata for larger
          data: att.size < 1048576 ? att.contentBytes : null,
        });
      }
    }

    return Response.json({
      body: resolved,
      attachments: regularAttachments,
    });
  } catch {
    return Response.json({ body: body || "", attachments: [] });
  }
}

// GET - download a specific attachment
export async function GET(req: Request) {
  const url = new URL(req.url);
  const messageId = url.searchParams.get("messageId");
  const attachmentId = url.searchParams.get("attachmentId");
  const userEmail = url.searchParams.get("email") || DEFAULT_SENDER_EMAIL;
  if (!isInternalEmail(userEmail)) {
    return Response.json({ error: "Invalid email" }, { status: 400 });
  }

  if (!messageId || !attachmentId) {
    return Response.json({ error: "Missing messageId or attachmentId" }, { status: 400 });
  }

  const token = await getAppToken();
  if (!token) return Response.json({ error: "No token" }, { status: 502 });

  try {
    const res = await fetch(
      `https://graph.microsoft.com/v1.0/users/${userEmail}/messages/${messageId}/attachments/${attachmentId}`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    if (!res.ok) return Response.json({ error: "Attachment not found" }, { status: 404 });

    const att = await res.json();
    if (!att.contentBytes) return Response.json({ error: "No content" }, { status: 404 });

    const buffer = Buffer.from(att.contentBytes, "base64");
    return new Response(buffer, {
      headers: {
        "Content-Type": att.contentType || "application/octet-stream",
        "Content-Disposition": `attachment; filename="${att.name}"`,
      },
    });
  } catch {
    return Response.json({ error: "Failed to download" }, { status: 500 });
  }
}
