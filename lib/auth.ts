import { SignJWT, jwtVerify } from "jose";
import { IDLE_MINUTES } from "@/lib/idle";

/* Edge-safe token helpers (middleware imports this file). Four cookies:
 *  - session: full access, checked against the user record in lib/session.ts
 *  - mfa:     password accepted, second factor pending (10 minutes)
 *  - trust:   "remember this browser" — skips the second factor for 48 hours
 *  - active:  last activity; the middleware renews it on every request and
 *             signs the user out once it has expired (idle timeout)
 * Session, mfa and trust carry the user's sessionVersion, so a password change,
 * disable or 2FA reset invalidates all of them at once. */

export const SESSION_COOKIE = "invoice_session";
export const MFA_COOKIE = "invoice_mfa";
export const TRUST_COOKIE = "invoice_trust";
export const ACTIVE_COOKIE = "invoice_active";

const REMEMBER_DAYS = 14;
const SHORT_SESSION_HOURS = 12;
const MFA_MINUTES = 10;
const TRUST_HOURS = 48;
/** The browser signs out at IDLE_MINUTES; the server's backstop allows a little longer,
 *  as the browser only reports activity once a minute. */
const ACTIVE_MINUTES = IDLE_MINUTES + 5;

function secret() {
  const value = process.env.SESSION_SECRET;
  if (!value) throw new Error("SESSION_SECRET is not set");
  return new TextEncoder().encode(value);
}

type Stage = "full" | "mfa" | "trust" | "active";

async function sign(stage: Stage, userId: string, version: number, ttl: string, extra: Record<string, unknown> = {}) {
  return new SignJWT({ sv: version, stg: stage, ...extra })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime(ttl)
    .sign(secret());
}

async function verify(token: string, stage: Stage) {
  try {
    const { payload } = await jwtVerify(token, secret());
    if (typeof payload.sub !== "string" || typeof payload.sv !== "number") return null;
    // Sessions issued before stages existed carry no `stg` and count as full.
    if ((payload.stg ?? "full") !== stage) return null;
    return payload;
  } catch {
    return null;
  }
}

export type SessionClaims = { userId: string; version: number };

export async function createSessionToken(userId: string, version: number, remember = true) {
  return sign("full", userId, version, remember ? `${REMEMBER_DAYS}d` : `${SHORT_SESSION_HOURS}h`);
}

/** Signature and expiry only; the user record is checked in lib/session.ts. */
export async function verifySessionToken(token: string): Promise<SessionClaims | null> {
  const p = await verify(token, "full");
  return p ? { userId: p.sub!, version: p.sv as number } : null;
}

export type MfaClaims = SessionClaims & { remember: boolean };

export async function createMfaToken(userId: string, version: number, remember: boolean) {
  return sign("mfa", userId, version, `${MFA_MINUTES}m`, { rem: remember });
}

export async function verifyMfaToken(token: string): Promise<MfaClaims | null> {
  const p = await verify(token, "mfa");
  return p ? { userId: p.sub!, version: p.sv as number, remember: p.rem === true } : null;
}

export async function createTrustToken(userId: string, version: number) {
  return sign("trust", userId, version, `${TRUST_HOURS}h`);
}

export async function verifyTrustToken(token: string): Promise<SessionClaims | null> {
  const p = await verify(token, "trust");
  return p ? { userId: p.sub!, version: p.sv as number } : null;
}

export async function createActiveToken(userId: string) {
  return sign("active", userId, 0, `${ACTIVE_MINUTES}m`);
}

/** Whether the user was active within the idle limit. */
export async function verifyActiveToken(token: string, userId: string) {
  const p = await verify(token, "active");
  return p?.sub === userId;
}

const base = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/",
};

/** Without "remember me" the cookie ends with the browser session. */
export function sessionCookieOptions(remember = true) {
  return remember ? { ...base, maxAge: REMEMBER_DAYS * 24 * 60 * 60 } : base;
}

export const mfaCookieOptions = { ...base, maxAge: MFA_MINUTES * 60 };
export const trustCookieOptions = { ...base, maxAge: TRUST_HOURS * 60 * 60 };
/** Outlives its token on purpose: an expired token still in the browser means "idle", not "never set". */
export const activeCookieOptions = { ...base, maxAge: REMEMBER_DAYS * 24 * 60 * 60 };
