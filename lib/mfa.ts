import "server-only";
import { createHash, randomInt } from "crypto";
import { cookies } from "next/headers";
import { generateSecret, generateURI, verify as verifyOtp } from "otplib";
import QRCode from "qrcode";
import { prisma } from "@/lib/db";
import {
  MFA_COOKIE,
  SESSION_COOKIE,
  TRUST_COOKIE,
  createMfaToken,
  createSessionToken,
  createTrustToken,
  mfaCookieOptions,
  sessionCookieOptions,
  trustCookieOptions,
  verifyMfaToken,
  verifyTrustToken,
} from "@/lib/auth";

/* Second-factor sign-in: password → (trusted browser? done) → authenticator
 * code, or an emailed code, → full session. */

const MAX_FAILURES = 5;
const EMAIL_CODE_MINUTES = 10;
export const EMAIL_CODE_COOLDOWN_SECONDS = 60;
const ISSUER = "STAR SAAS Back Office";

export const sha256 = (v: string) => createHash("sha256").update(v).digest("hex");

const pendingSelect = {
  id: true,
  email: true,
  name: true,
  active: true,
  sessionVersion: true,
  totpSecret: true,
  totpPendingSecret: true,
  emailCodeHash: true,
  emailCodeSentAt: true,
  mfaFailures: true,
} as const;

/** The user who passed the password step and still owes a second factor. */
export async function getPendingUser() {
  const token = cookies().get(MFA_COOKIE)?.value;
  const claims = token ? await verifyMfaToken(token) : null;
  if (!claims) return null;
  const user = await prisma.user.findUnique({ where: { id: claims.userId }, select: pendingSelect });
  if (!user || !user.active || user.sessionVersion !== claims.version) return null;
  return { ...user, remember: claims.remember };
}

export type PendingUser = NonNullable<Awaited<ReturnType<typeof getPendingUser>>>;

/** Whether this browser completed 2FA for the user within the last 48 hours. */
export async function isTrustedBrowser(userId: string, version: number) {
  const token = cookies().get(TRUST_COOKIE)?.value;
  const claims = token ? await verifyTrustToken(token) : null;
  return Boolean(claims && claims.userId === userId && claims.version === version);
}

export async function startMfa(userId: string, version: number, remember: boolean) {
  cookies().set(MFA_COOKIE, await createMfaToken(userId, version, remember), mfaCookieOptions);
}

export async function completeSignIn(userId: string, version: number, remember: boolean, trustBrowser: boolean) {
  await prisma.user.update({
    where: { id: userId },
    data: { lastLoginAt: new Date(), mfaFailures: 0, emailCodeHash: null },
  });
  const jar = cookies();
  jar.set(SESSION_COOKIE, await createSessionToken(userId, version, remember), sessionCookieOptions(remember));
  jar.delete(MFA_COOKIE);
  if (trustBrowser) jar.set(TRUST_COOKIE, await createTrustToken(userId, version), trustCookieOptions);
}

/** Counts a wrong code; after too many the attempt ends and the user must
 *  sign in with their password again. Returns true when that happened. */
export async function recordFailure(userId: string) {
  const { mfaFailures } = await prisma.user.update({
    where: { id: userId },
    data: { mfaFailures: { increment: 1 } },
    select: { mfaFailures: true },
  });
  if (mfaFailures < MAX_FAILURES) return false;
  await prisma.user.update({ where: { id: userId }, data: { mfaFailures: 0, emailCodeHash: null } });
  cookies().delete(MFA_COOKIE);
  return true;
}

export async function checkTotp(secret: string, code: string) {
  if (!/^\d{6}$/.test(code)) return false;
  // ±30s tolerance absorbs device clock drift.
  const result = await verifyOtp({ secret, token: code, epochTolerance: 30 }).catch(() => ({ valid: false }));
  return result.valid;
}

/** A fresh secret and its QR code; the caller stores it as pending. */
export async function newTotpSetup(email: string) {
  const secret = generateSecret();
  const qr = await QRCode.toDataURL(generateURI({ issuer: ISSUER, label: email, secret }), { margin: 1, width: 240 });
  return { secret, qr };
}

export function newEmailCode() {
  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  return { code, hash: sha256(code) };
}

export function emailCodeValid(user: Pick<PendingUser, "emailCodeHash" | "emailCodeSentAt">, code: string) {
  if (!user.emailCodeHash || !user.emailCodeSentAt) return false;
  if (Date.now() - user.emailCodeSentAt.getTime() > EMAIL_CODE_MINUTES * 60_000) return false;
  return user.emailCodeHash === sha256(code);
}

export function maskEmail(email: string) {
  const [local, domain] = email.split("@");
  if (!domain) return email;
  const shown = local.length <= 2 ? local[0] : local.slice(0, 2);
  return `${shown}${"•".repeat(Math.max(1, Math.min(6, local.length - shown.length)))}@${domain}`;
}
