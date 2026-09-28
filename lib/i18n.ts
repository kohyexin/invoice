/* English-only shim for the Gatehub components this app reuses: `t` fills
   {0}, {1}, ... placeholders and returns the English string. */

export function t(text: string, ...args: (string | number)[]) {
  return args.reduce<string>((out, arg, i) => out.replace(`{${i}}`, String(arg)), text);
}

export function useI18n(): { locale: "en" | "zh-CN"; t: typeof t } {
  return { locale: "en", t };
}
