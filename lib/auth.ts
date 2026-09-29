import { SignJWT, jwtVerify } from "jose";

export const SESSION_COOKIE = "invoice_session";
const SESSION_DAYS = 14;

function secret() {
  const value = process.env.SESSION_SECRET;
  if (!value) throw new Error("SESSION_SECRET is not set");
  return new TextEncoder().encode(value);
}

export type SessionClaims = { userId: string; version: number };

export async function createSessionToken(userId: string, version: number) {
  return new SignJWT({ sv: version })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime(`${SESSION_DAYS}d`)
    .sign(secret());
}

/** Signature and expiry only; the user record is checked in lib/session.ts. */
export async function verifySessionToken(token: string): Promise<SessionClaims | null> {
  try {
    const { payload } = await jwtVerify(token, secret());
    if (typeof payload.sub !== "string" || typeof payload.sv !== "number") return null;
    return { userId: payload.sub, version: payload.sv };
  } catch {
    return null;
  }
}

export const SESSION_MAX_AGE = SESSION_DAYS * 24 * 60 * 60;

export const sessionCookieOptions = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/",
  maxAge: SESSION_MAX_AGE,
};
