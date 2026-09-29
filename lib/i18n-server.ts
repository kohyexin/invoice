import "server-only";
import { cookies } from "next/headers";
import { LOCALE_COOKIE, makeT, parseLocale } from "./i18n";

export function getLocale() {
  return parseLocale(cookies().get(LOCALE_COOKIE)?.value);
}

/** Locale and translator for server components and server actions. */
export function getI18n() {
  const locale = getLocale();
  return { locale, t: makeT(locale) };
}
