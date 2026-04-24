import { cookies } from "next/headers";
import { supabase } from "@/services/base";
import { createSessionToken, SESSION_COOKIE_NAME, type SessionPayload } from "@/lib/session";

const CLIENT_ID = process.env.AZURE_CLIENT_ID || "";
const CLIENT_SECRET = process.env.AZURE_CLIENT_SECRET || "";
const TENANT_ID = process.env.AZURE_TENANT_ID || "";
const REDIRECT_URI = process.env.AZURE_REDIRECT_URI || "https://braiin.app/api/auth/callback";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const error = url.searchParams.get("error");
  const returnedState = url.searchParams.get("state");

  if (error || !code) {
    console.error("[auth] OAuth error:", error || "no code");
    return Response.redirect(new URL("/", req.url), 302);
  }

  // Verify OAuth CSRF state
  const cookieStore = await cookies();
  const storedState = cookieStore.get("braiin_oauth_state")?.value;
  // Clear the state cookie immediately after reading
  cookieStore.delete("braiin_oauth_state");

  if (!storedState || !returnedState || storedState !== returnedState) {
    console.error("[auth] State mismatch - possible CSRF attempt");
    return Response.redirect(new URL("/", req.url), 302);
  }

  // Exchange code for tokens
  const tokenRes = await fetch(`https://login.microsoftonline.com/${TENANT_ID}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      code,
      redirect_uri: REDIRECT_URI,
      grant_type: "authorization_code",
      scope: "openid profile email User.Read Mail.Read Mail.Send Mail.ReadWrite",
    }),
  });

  const tokenData = await tokenRes.json();

  if (!tokenData.access_token) {
    console.error("[auth] Token exchange failed:", tokenData.error || "no access_token");
    return Response.redirect(new URL("/", req.url), 302);
  }

  // Get user profile from Microsoft
  const profileRes = await fetch("https://graph.microsoft.com/v1.0/me", {
    headers: { Authorization: `Bearer ${tokenData.access_token}` },
  });
  const profile = await profileRes.json();

  const email = (profile.mail || profile.userPrincipalName || "").toLowerCase();
  const name = profile.displayName || "";

  if (!email) {
    console.error("[auth] No email in profile:", profile);
    return Response.redirect(new URL("/", req.url), 302);
  }

  // Whitelist - only these emails can log in
  const allowedEmails = (process.env.ALLOWED_EMAILS || process.env.ADMIN_EMAILS || "")
    .split(",")
    .map(e => e.trim().toLowerCase())
    .filter(Boolean);
  if (!allowedEmails.includes(email)) {
    console.warn(`[auth] Blocked login attempt: ${email}`);
    return Response.redirect(new URL("/", req.url), 302);
  }

  // Check if user exists in staff table
  let staff = null;

  // Only exact email match - no fuzzy name matching for security
  const { data: byEmail } = await supabase
    .from("staff")
    .select("id, name, role, department, branch, is_active")
    .eq("is_active", true)
    .eq("email", email)
    .single();
  staff = byEmail;

  if (!staff) {
    // Staff record not found - user will get viewer role
    console.warn(`[auth] No staff record for ${email} - assigning viewer role`);
  }

  // Build and sign the session JWT.
  // Deliberately excludes Azure access_token and refresh_token: they are never
  // read anywhere in the application (all Graph calls use app-level
  // client_credentials), so putting them in a cookie served only as a leak
  // vector. If user-delegated Graph access is ever needed, store the tokens
  // in a dedicated encrypted table keyed by staff_id - not in the session.
  const session: SessionPayload = {
    email,
    name,
    expires_at: Date.now() + (tokenData.expires_in || 3600) * 1000,
    staff_id: staff?.id || null,
    role: staff?.role || "viewer",
    department: staff?.department || "",
    branch: staff?.branch || "",
    is_staff: !!staff,
  };

  const token = await createSessionToken(session);

  cookieStore.set(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    maxAge: 60 * 60 * 8, // 8 hours
    path: "/",
  });

  return Response.redirect(new URL("/", req.url), 302);
}
