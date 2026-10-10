import { NextResponse, type NextRequest } from "next/server";
import { ACTIVE_COOKIE, MFA_COOKIE, SESSION_COOKIE, activeCookieOptions, createActiveToken, verifyActiveToken, verifySessionToken } from "@/lib/auth";
import { IDLE_MINUTES } from "@/lib/idle";

/** Sign-in, second factor, password reset and agreement signing links work without a session. */
const PUBLIC_PAGES = /^\/(login|verify|reset|invite|sign)(\/|$)/;

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // A validly signed cookie may still belong to a disabled or signed-out user
  // (checked against the database in lib/session.ts), so these pages decide
  // for themselves whether to bounce to the dashboard.
  if (PUBLIC_PAGES.test(pathname)) return NextResponse.next();

  const token = req.cookies.get(SESSION_COOKIE)?.value;
  const session = token ? await verifySessionToken(token) : null;
  const api = pathname.startsWith("/api/");

  if (!session) {
    return api ? NextResponse.json({ error: "Unauthorized" }, { status: 401 }) : NextResponse.redirect(new URL("/login", req.url));
  }

  // Sessions from before the idle timeout have no activity cookie yet; they get one now.
  const active = req.cookies.get(ACTIVE_COOKIE)?.value;
  if (active !== undefined && !(await verifyActiveToken(active, session.userId))) {
    const res = api
      ? NextResponse.json({ error: `Signed out after ${IDLE_MINUTES} minutes without activity.` }, { status: 401 })
      : NextResponse.redirect(new URL("/login?idle=1", req.url));
    for (const name of [SESSION_COOKIE, MFA_COOKIE, ACTIVE_COOKIE]) res.cookies.set(name, "", { path: "/", maxAge: 0 });
    return res;
  }

  const res = NextResponse.next();
  res.cookies.set(ACTIVE_COOKIE, await createActiveToken(session.userId), activeCookieOptions);
  return res;
}

export const config = {
  // Everything except the auth API, the cron endpoint, the signing-link API
  // (the token is checked there), the deploy version check, static assets and fonts.
  matcher: ["/((?!api/auth|api/cron|api/sign/|api/version|_next|logos|brand|fonts|favicon.ico).*)"],
};
