/* How a bank account is named on screen: the institution (or the bank's own
   product name) and the last four digits of the account number, the way banks
   and auditors refer to accounts. The short label ("SGD (ANEXT)") stays as a
   nickname; the workbook import matches on it. */

type Named = { label: string; currency: string; bankName?: string | null; accountType?: string | null; accountNumber?: string | null };

const LEGAL_SUFFIX = /[\s,]+(pte\.?\s*ltd\.?|private limited|limited|ltd\.?|co\.?,?\s*ltd\.?|inc\.?|corp\.?)$/i;

export function accountName(a: Named) {
  const digits = (a.accountNumber ?? "").replace(/\D/g, "");
  const tail = digits.length >= 4 ? ` ··${digits.slice(-4)}` : "";
  const bank = (a.bankName ?? "").trim().replace(LEGAL_SUFFIX, "").trim();
  const base = (a.accountType ?? "").trim() || bank;
  if (base) return base + tail;
  // No bank details yet: "USD (XMXY)" -> "XMXY", so the currency isn't repeated.
  const nick = a.label.match(new RegExp(`^${a.currency}\\s*\\((.+)\\)$`, "i"))?.[1] ?? a.label;
  return nick + tail;
}

/** For lists without a currency column, where two currencies of one account must stay apart. */
export function accountNameWithCurrency(a: Named) {
  return `${accountName(a)} · ${a.currency}`;
}
