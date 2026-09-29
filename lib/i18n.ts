import { ZH } from "./i18n-zh";

/* English source strings double as dictionary keys, so anything not yet
   translated falls back to English. The locale lives in a cookie so server
   components render in the same language as the client. */

export type Locale = "en" | "zh-CN";

export const LOCALE_COOKIE = "inv-locale";

export const LOCALES: { id: Locale; label: string }[] = [
  { id: "en", label: "English" },
  { id: "zh-CN", label: "简体中文" },
];

export function parseLocale(value: string | null | undefined): Locale {
  return value === "zh-CN" ? "zh-CN" : "en";
}

export type Translate = (text: string, ...args: (string | number)[]) => string;

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/* Keys with placeholders double as patterns, so messages that arrive already
   interpolated (server-action errors) still translate. */
const ZH_PATTERNS = Object.keys(ZH)
  .filter((k) => /\{\d\}/.test(k))
  .map((k) => ({
    re: new RegExp(`^${escapeRe(k).replace(/\\\{(\d)\\\}/g, "(?<p$1>[\\s\\S]+?)")}$`),
    out: ZH[k],
  }));

function lookupZh(text: string): string {
  const exact = ZH[text];
  if (exact !== undefined) return exact;
  for (const { re, out } of ZH_PATTERNS) {
    const m = re.exec(text);
    if (m?.groups) return out.replace(/\{(\d)\}/g, (_, i) => m.groups![`p${i}`] ?? "");
  }
  return text;
}

/** `{0}`, `{1}`… placeholders are replaced with `args`. */
export function translate(locale: Locale, text: string, ...args: (string | number)[]) {
  const out = locale === "zh-CN" ? lookupZh(text) : text;
  return args.reduce<string>((s, arg, i) => s.replaceAll(`{${i}}`, String(arg)), out);
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-09" → "Sep 2026" / "2026年9月"; `short` gives "Sep '26" / "26年9月". */
export function formatMonth(locale: Locale, ym: string, style: "long" | "short" = "long") {
  const year = ym.slice(0, 4);
  const month = Number(ym.slice(5, 7));
  if (locale === "zh-CN") return `${style === "short" ? year.slice(2) : year}年${month}月`;
  return `${MONTHS[month - 1]} ${style === "short" ? `'${year.slice(2)}` : year}`;
}

export function makeT(locale: Locale): Translate {
  return (text, ...args) => translate(locale, text, ...args);
}
