import { NextResponse } from "next/server";
import { ACTIVE_COOKIE, MFA_COOKIE, SESSION_COOKIE } from "@/lib/auth";

/** Leaves the 48-hour trusted-browser cookie in place: that belongs to the
 *  browser, not the session. */
export async function POST() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, "", { path: "/", maxAge: 0 });
  res.cookies.set(MFA_COOKIE, "", { path: "/", maxAge: 0 });
  res.cookies.set(ACTIVE_COOKIE, "", { path: "/", maxAge: 0 });
  return res;
}
