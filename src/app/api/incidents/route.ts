import { getIncidents, createIncident } from "@/services/incidents";
import { incidentSchema, apiResponse, apiError, validationError } from "@/lib/validation";
import { cookies } from "next/headers";
import { createClient } from "@supabase/supabase-js";
import { DEFAULT_SENDER_EMAIL, APP_URL } from "@/config/customer";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

async function getSession() {
  const cookieStore = await cookies();
  const session = cookieStore.get("braiin_session");
  if (!session?.value) return null;
  try { return JSON.parse(session.value); } catch { return null; }
}

function escapeHtml(text: string): string {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Send email to directors for Black incidents
async function emailDirectors(incident: any) {
  const CLIENT_ID = process.env.AZURE_CLIENT_ID || "";
  const CLIENT_SECRET = process.env.AZURE_CLIENT_SECRET || "";
  const TENANT_ID = process.env.AZURE_TENANT_ID || "";

  const tokenRes = await fetch(`https://login.microsoftonline.com/${TENANT_ID}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: CLIENT_ID, client_secret: CLIENT_SECRET,
      scope: "https://graph.microsoft.com/.default", grant_type: "client_credentials",
    }),
  });
  const tokenData = await tokenRes.json();
  if (!tokenData.access_token) return;

  // Get director emails
  const { data: directors } = await supabase.from("staff")
    .select("email")
    .eq("is_active", true)
    .in("access_role", ["admin", "super_admin", "branch_md"]);

  for (const director of (directors || [])) {
    await fetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(DEFAULT_SENDER_EMAIL)}/sendMail`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${tokenData.access_token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        message: {
          subject: `BLACK INCIDENT: ${escapeHtml(incident.title)}`,
          body: {
            contentType: "HTML",
            content: `<h2 style="color:red">BLACK INCIDENT</h2>
              <p><strong>${escapeHtml(incident.title)}</strong></p>
              <p>Category: ${escapeHtml(incident.category || "")}</p>
              <p>Client: ${escapeHtml(incident.account_code || "N/A")}</p>
              <p>Supplier: ${escapeHtml(incident.supplier_account_code || "N/A")}</p>
              <p>Job ref: ${escapeHtml(incident.job_reference || "N/A")}</p>
              <p>${escapeHtml(incident.description || "")}</p>
              <p><a href="${APP_URL}/incidents?id=${encodeURIComponent(incident.id)}">View incident</a></p>`,
          },
          toRecipients: [{ emailAddress: { address: director.email } }],
        },
        saveToSentItems: false,
      }),
    }).catch(() => {});
  }
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const severity = url.searchParams.get("severity") || undefined;
  const status = url.searchParams.get("status") || undefined;
  const account_code = url.searchParams.get("account_code") || undefined;
  const supplier_account_code = url.searchParams.get("supplier_account_code") || undefined;
  const branch = url.searchParams.get("branch") || undefined;
  const job_reference = url.searchParams.get("job_reference") || undefined;

  try {
    const incidents = await getIncidents({ severity, status, account_code, supplier_account_code, branch, job_reference });
    return apiResponse({ incidents });
  } catch (e: any) {
    return apiError(e.message, 500);
  }
}

export async function POST(req: Request) {
  const session = await getSession();
  if (!session?.email) return apiError("Not authenticated", 401);

  const body = await req.json();
  const parsed = incidentSchema.safeParse(body);
  if (!parsed.success) return validationError(parsed.error);

  try {
    const incident = await createIncident(parsed.data, {
      email: session.email,
      name: session.name || session.email.split("@")[0],
    });

    // Black incidents: send email to directors
    if (incident.severity === "black") {
      emailDirectors(incident).catch(() => {});
    }

    return apiResponse({ incident }, 201);
  } catch (e: any) {
    return apiError(e.message, 500);
  }
}
