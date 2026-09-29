import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export const CURRENCIES = ["USD", "HKD", "CNY", "EUR", "SGD"] as const;
export type CurrencyCode = (typeof CURRENCIES)[number];

export const CURRENCY_SYMBOL: Record<CurrencyCode, string> = {
  USD: "$",
  HKD: "HK$",
  CNY: "¥",
  EUR: "€",
  SGD: "S$",
};

export const STATUSES = ["SENT", "PAID", "END", "LOST", "WAIVED"] as const;
export type StatusCode = (typeof STATUSES)[number];

export function round2(n: number) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export function formatMoney(value: number | null | undefined, digits = 2) {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value);
}

export function formatCurrency(value: number, currency: string = "USD") {
  return `${currency} ${formatMoney(value)}`;
}

export function formatCompact(value: number) {
  return new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
}

export function formatNumber(value: number) {
  return new Intl.NumberFormat("en-US").format(value);
}

/** Dates are stored as UTC midnight; read them back in UTC. */
export function formatDate(value: string | Date | null | undefined) {
  if (!value) return "—";
  const d = typeof value === "string" ? new Date(value) : value;
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${dd}/${mm}/${d.getUTCFullYear()}`;
}

const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

export function formatMonth(value: string | Date) {
  const d = typeof value === "string" ? new Date(value) : value;
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** yyyy-mm-dd for <input type="date">. */
export function toDateInput(value: string | Date | null | undefined) {
  if (!value) return "";
  const d = typeof value === "string" ? new Date(value) : value;
  return d.toISOString().slice(0, 10);
}

export function parseDateInput(value: string | null | undefined): Date | null {
  if (!value) return null;
  const d = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function addDays(d: Date, days: number) {
  const next = new Date(d);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

const LEDGER_MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEPT", "OCT", "NOV", "DEC"];

/** Fills {month} in an item's default subtype with the invoice month as the ledger writes it, e.g. SEPT 2026. */
export function ledgerSubtype(template: string, invoiceDate: string) {
  const d = new Date(`${invoiceDate}T00:00:00Z`);
  if (!template.includes("{month}") || Number.isNaN(d.getTime())) return template;
  return template.replaceAll("{month}", `${LEDGER_MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`);
}

export function todayUtc() {
  const now = new Date();
  return new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
}
