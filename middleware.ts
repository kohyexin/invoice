import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/auth";

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  const session = token ? await verifySessionToken(token) : null;

  // A validly signed cookie may still belong to a disabled or signed-out user
  // (checked against the database in lib/session.ts), so the login page
  // decides for itself whether to bounce to the dashboard.
  if (pathname === "/login") return NextResponse.next();

  if (pathname.startsWith("/api/")) {
    return session
      ? NextResponse.next()
      : NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!session) return NextResponse.redirect(new URL("/login", req.url));
  return NextResponse.next();
}

export const config = {
  // Everything except the login API, the cron endpoint, static assets and fonts.
  matcher: ["/((?!api/auth|api/cron|_next|logos|fonts|favicon.ico).*)"],
};
