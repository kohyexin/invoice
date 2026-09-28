import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { SESSION_COOKIE, SESSION_MAX_AGE, createSessionToken } from "@/lib/auth";

export async function POST(req: Request) {
  const { email, password } = (await req.json().catch(() => ({}))) as {
    email?: string;
    password?: string;
  };

  const expectedEmail = process.env.APP_LOGIN_EMAIL?.trim().toLowerCase();
  const hash = process.env.APP_PASSWORD_HASH;
  if (!expectedEmail || !hash) {
    return NextResponse.json(
      { error: "Sign-in is not configured. Set APP_LOGIN_EMAIL and APP_PASSWORD_HASH in .env." },
      { status: 500 }
    );
  }

  const ok =
    email?.trim().toLowerCase() === expectedEmail &&
    typeof password === "string" &&
    (await bcrypt.compare(password, hash));
  if (!ok) {
    return NextResponse.json({ error: "Email or password is incorrect." }, { status: 401 });
  }

  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, await createSessionToken(expectedEmail), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_MAX_AGE,
  });
  return res;
}
