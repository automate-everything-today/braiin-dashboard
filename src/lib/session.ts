import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";

const rawSecret = process.env.SESSION_SECRET;

if (!rawSecret || rawSecret.length < 32) {
  throw new Error(
    "SESSION_SECRET is required and must be at least 32 characters. Refusing to start with a weak or missing session secret.",
  );
}

const SECRET = new TextEncoder().encode(rawSecret);
const ISSUER = "braiin.app";
const AUDIENCE = "braiin.app";
const COOKIE_NAME = "braiin_session";

export type SessionPayload = {
  email: string;
  name: string;
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
  } catch (err) {
    console.warn("[session] JWT verification failed:", err instanceof Error ? err.message : err);
    return null;
  }
}

/**
 * Reads the current request's session cookie and cryptographically verifies it.
 * Returns null if the cookie is missing, forged, expired, or otherwise invalid.
 * Use this in every API route that requires authentication.
 */
export async function getSession(): Promise<SessionPayload | null> {
  const cookieStore = await cookies();
  const cookie = cookieStore.get(COOKIE_NAME);
  if (!cookie?.value) return null;
  const payload = await verifySessionToken(cookie.value);
  if (!payload) return null;
  if (payload.expires_at && payload.expires_at < Date.now()) return null;
  return payload;
}

export const SESSION_COOKIE_NAME = COOKIE_NAME;
