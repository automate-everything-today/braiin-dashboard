import { SignJWT, jwtVerify } from "jose";

const SECRET = new TextEncoder().encode(
  process.env.SESSION_SECRET || process.env.SUPABASE_SERVICE_KEY || "fallback-dev-secret-change-me",
);

const ISSUER = "braiin.app";
const AUDIENCE = "braiin.app";

export type SessionPayload = {
  email: string;
  name: string;
  azure_token: string;
  refresh_token: string;
  expires_at: number;
  staff_id: number | null;
  role: string;
  department: string;
  branch: string;
  is_staff: boolean;
};

export async function createSessionToken(payload: SessionPayload): Promise<string> {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setExpirationTime("8h")
    .sign(SECRET);
}

export async function verifySessionToken(token: string): Promise<SessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, SECRET, {
      issuer: ISSUER,
      audience: AUDIENCE,
    });
    return payload as unknown as SessionPayload;
  } catch {
    return null;
  }
}
