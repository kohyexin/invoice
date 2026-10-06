import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/auth";

/** Sign-in, second factor and password reset work without a session. */
const PUBLIC_PAGES = /^\/(login|verify|reset|invite)(\/|$)/;

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // A validly signed cookie may still belong to a disabled or signed-out user
  // (checked against the database in lib/session.ts), so these pages decide
  // for themselves whether to bounce to the dashboard.
  if (PUBLIC_PAGES.test(pathname)) return NextResponse.next();

  const token = req.cookies.get(SESSION_COOKIE)?.value;
  const session = token ? await verifySessionToken(token) : null;

  if (pathname.startsWith("/api/")) {
    return session
      ? NextResponse.next()
      : NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!session) return NextResponse.redirect(new URL("/login", req.url));
  return NextResponse.next();
}

export const config = {
  // Everything except the auth API, the cron endpoint, static assets and fonts.
  matcher: ["/((?!api/auth|api/cron|_next|logos|brand|fonts|favicon.ico).*)"],
};
