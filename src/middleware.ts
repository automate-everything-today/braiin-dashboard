import { NextRequest, NextResponse } from "next/server";

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Only apply to /api/ routes
  if (!pathname.startsWith("/api/")) return NextResponse.next();

  // Allow auth routes through without a session check
  if (pathname.startsWith("/api/auth/")) return NextResponse.next();

  // Allow cron routes (secured by CRON_SECRET in the route handler)
  if (pathname.startsWith("/api/cron/")) return NextResponse.next();

  const session = req.cookies.get("braiin_session");
  if (!session?.value) {
    return NextResponse.json({ success: false, error: "Not authenticated" }, { status: 401 });
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/api/:path*"],
};
