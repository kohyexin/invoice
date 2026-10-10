import "server-only";
import { prisma } from "@/lib/db";

/* Agreement e-signing options, edited on the Settings page. */

const SETTING_KEY = "agreementSigning";

export type SigningSettings = {
  /** Pre-filled as the STAR SAAS signer when sending an agreement. */
  companySignerName: string;
  companySignerEmail: string;
  /** How long a signing link works. */
  linkDays: number;
  /** Days between reminders to someone who hasn't signed. */
  reminderIntervalDays: number;
  /** Reminders per signer; 0 turns them off. */
  maxReminders: number;
  /** Address used in emailed links, e.g. https://star-invoice.vercel.app. Empty: worked out from the request. */
  appUrl: string;
};

export const SIGNING_DEFAULTS: SigningSettings = {
  companySignerName: "",
  companySignerEmail: "",
  linkDays: 90,
  reminderIntervalDays: 3,
  maxReminders: 5,
  appUrl: "",
};

export const SIGNING_LIMITS = {
  linkDays: [1, 365],
  reminderIntervalDays: [1, 30],
  maxReminders: [0, 20],
} as const;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Checks and tidies submitted settings; the error is shown on the form. */
export function validateSigningSettings(input: Partial<SigningSettings>): { ok: true; value: SigningSettings } | { ok: false; error: string } {
  const value: SigningSettings = {
    companySignerName: String(input.companySignerName ?? "").trim().replace(/\s+/g, " ").slice(0, 100),
    companySignerEmail: String(input.companySignerEmail ?? "").trim().toLowerCase(),
    linkDays: Math.round(Number(input.linkDays)),
    reminderIntervalDays: Math.round(Number(input.reminderIntervalDays)),
    maxReminders: Math.round(Number(input.maxReminders)),
    appUrl: String(input.appUrl ?? "").trim().replace(/\/+$/, ""),
  };
  if (value.companySignerEmail && !EMAIL_RE.test(value.companySignerEmail)) return { ok: false, error: "Enter a valid email for the company signer." };
  for (const [key, [min, max]] of Object.entries(SIGNING_LIMITS) as [keyof typeof SIGNING_LIMITS, readonly [number, number]][]) {
    const n = value[key];
    if (!Number.isFinite(n) || n < min || n > max) return { ok: false, error: "Enter whole numbers within the limits shown." };
  }
  if (value.appUrl) {
    let url: URL | null = null;
    try {
      url = new URL(value.appUrl);
    } catch {
      /* invalid */
    }
    if (!url || !/^https?:$/.test(url.protocol) || url.pathname !== "/" || url.search || url.hash) {
      return { ok: false, error: "Enter the app address only, like https://star-invoice.vercel.app." };
    }
    value.appUrl = url.origin;
  }
  return { ok: true, value };
}

export async function getSigningSettings(): Promise<SigningSettings> {
  const row = await prisma.appSetting.findUnique({ where: { key: SETTING_KEY } });
  const saved = (row?.value ?? {}) as Partial<SigningSettings>;
  const merged = { ...SIGNING_DEFAULTS, ...saved };
  const checked = validateSigningSettings(merged);
  return checked.ok ? checked.value : SIGNING_DEFAULTS;
}

export async function saveSigningSettings(value: SigningSettings) {
  const json = value as unknown as object;
  await prisma.appSetting.upsert({ where: { key: SETTING_KEY }, update: { value: json }, create: { key: SETTING_KEY, value: json } });
}
