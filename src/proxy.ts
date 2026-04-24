import { NextRequest, NextResponse } from "next/server";
import { verifySessionToken, SESSION_COOKIE_NAME } from "@/lib/session";

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Only apply to /api/ routes
  if (!pathname.startsWith("/api/")) return NextResponse.next();

  // Allow auth routes through without a session check
  if (pathname.startsWith("/api/auth/")) return NextResponse.next();

  // Allow cron routes (secured by CRON_SECRET in the route handler)
  if (pathname.startsWith("/api/cron/")) return NextResponse.next();

  const cookie = req.cookies.get(SESSION_COOKIE_NAME);
  if (!cookie?.value) {
    return NextResponse.json({ success: false, error: "Not authenticated" }, { status: 401 });
  }

  const payload = await verifySessionToken(cookie.value);
  if (!payload) {
    return NextResponse.json({ success: false, error: "Invalid session" }, { status: 401 });
  }

  if (payload.expires_at && payload.expires_at < Date.now()) {
    return NextResponse.json({ success: false, error: "Session expired" }, { status: 401 });
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/api/:path*"],
};
