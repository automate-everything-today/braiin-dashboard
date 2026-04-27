import { NextRequest, NextResponse } from "next/server";
import { verifySessionToken, createSessionToken, SESSION_COOKIE_NAME } from "@/lib/session";

const SESSION_TTL_MS = 8 * 60 * 60 * 1000;
// Refresh threshold: if the session has less than this much time left when
// an authenticated request comes through, mint a fresh JWT and set it on
// the response. Picked at half the TTL so a user active at any cadence
// faster than once-per-4-hours never sees a session expiry mid-task.
const REFRESH_THRESHOLD_MS = 4 * 60 * 60 * 1000;

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Only apply to /api/ routes
  if (!pathname.startsWith("/api/")) return NextResponse.next();

  // Allow auth routes through without a session check
  if (pathname.startsWith("/api/auth/")) return NextResponse.next();

  // Allow cron routes (secured by CRON_SECRET in the route handler)
  if (pathname.startsWith("/api/cron/")) return NextResponse.next();

  // Allow inbound webhook routes (secured by INBOUND_WEBHOOK_SECRET in the route handler)
  if (pathname.startsWith("/api/inbound/")) return NextResponse.next();

  const cookie = req.cookies.get(SESSION_COOKIE_NAME);
  if (!cookie?.value) {
    return NextResponse.json({ success: false, error: "Not authenticated" }, { status: 401 });
  }

  const payload = await verifySessionToken(cookie.value);
  if (!payload) {
    return NextResponse.json({ success: false, error: "Invalid session" }, { status: 401 });
  }

  const now = Date.now();
  if (payload.expires_at && payload.expires_at < now) {
    return NextResponse.json({ success: false, error: "Session expired" }, { status: 401 });
  }

  // Sliding refresh: if the session is about to expire, mint a fresh
  // 8-hour token and return it as a Set-Cookie. The original request
  // proceeds normally; the next request will use the new cookie. Means
  // an active user never gets logged out mid-task.
  const remainingMs = (payload.expires_at ?? 0) - now;
  if (remainingMs > 0 && remainingMs < REFRESH_THRESHOLD_MS) {
    try {
      const refreshed = { ...payload, expires_at: now + SESSION_TTL_MS };
      const token = await createSessionToken(refreshed);
      const res = NextResponse.next();
      res.cookies.set(SESSION_COOKIE_NAME, token, {
        httpOnly: true,
        secure: true,
        sameSite: "lax",
        maxAge: SESSION_TTL_MS / 1000,
        path: "/",
      });
      return res;
    } catch (err) {
      // Refresh failure is non-fatal - the original token is still valid
      // for the rest of its TTL. Log and let the request through.
      console.warn("[proxy] session refresh failed:", err instanceof Error ? err.message : err);
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/api/:path*"],
};
