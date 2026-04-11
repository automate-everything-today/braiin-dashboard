import { cookies } from "next/headers";

const CLIENT_ID = process.env.AZURE_CLIENT_ID || "";
const TENANT_ID = process.env.AZURE_TENANT_ID || "";
const REDIRECT_URI = process.env.AZURE_REDIRECT_URI || "https://braiin.app/api/auth/callback";

export async function GET() {
  const state = crypto.randomUUID();

  const cookieStore = await cookies();
  cookieStore.set("braiin_oauth_state", state, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    maxAge: 60 * 10, // 10 minutes - enough time to complete login
    path: "/",
  });

  const scope = encodeURIComponent("openid profile email User.Read Mail.Read Mail.Send Mail.ReadWrite");
  const authUrl = `https://login.microsoftonline.com/${TENANT_ID}/oauth2/v2.0/authorize?client_id=${CLIENT_ID}&response_type=code&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&response_mode=query&scope=${scope}&state=${encodeURIComponent(state)}`;

  return Response.redirect(authUrl, 302);
}
