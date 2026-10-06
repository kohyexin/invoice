import type { ParsedStatement, StatementEntry, StatementSection } from "./types";

/* ANEXT Bank (Singapore) monthly account statements. Two layouts are in use:
   up to May 2026 the running balance sits on each entry line and sections end
   with "Total"; from June 2026 there is an Account Summary, the daily balance
   is on its own line and sections end with "Closing Balance". */

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DATE = String.raw`(\d{2}) (${MONTHS.join("|")}) (\d{4})`;
const AMOUNT = String.raw`[\d,]+\.\d{2}`;
const CURRENCY_LINE = /^(SGD|USD|EUR|HKD|CNH|CNY|GBP|AUD|JPY)$/;

const isoDate = (d: string, m: string, y: string) => `${y}-${String(MONTHS.indexOf(m) + 1).padStart(2, "0")}-${d}`;
const amount = (s: string) => Math.round(Number(s.replace(/,/g, "")) * 100) / 100;
const round2 = (n: number) => Math.round(n * 100) / 100;

export function isAnext(text: string) {
  return /ANEXT Bank Pte\. Ltd\./i.test(text) && /Account No:/i.test(text);
}

/** "Outgoing FAST Transfer to ROBIN KOH YE XIN (Account Ending 1001)" -> "ROBIN KOH YE XIN". */
export function counterpartyOf(description: string) {
  const m = description.match(/\b(?:to|from)\s+(.+?)(?:\s*\(Account Ending[^)]*\))?\s*$/i);
  return (m ? m[1] : description).replace(/\s+/g, " ").trim().toUpperCase();
}

export function parseAnext(pages: string[]): ParsedStatement {
  const all = pages.join("\n");
  const line = (re: RegExp) => all.match(re)?.[1]?.trim() ?? "";

  const lines = all.split("\n").map((l) => l.trim());
  const noIdx = lines.findIndex((l) => /^Account No:/i.test(l));
  const stmtIdx = lines.findIndex((l) => l === "Account Statement");
  const accountNumber = line(/Account No:\s*([\d\s-]+)/).replace(/[\s-]/g, "");
  const period = all.match(new RegExp(`Period: ${DATE} to ${DATE}`));
  if (!accountNumber || !period) throw new Error("This doesn't look like an ANEXT account statement (no account number or period).");

  const sections = new Map<string, StatementSection>();
  for (const page of pages) {
    const pageLines = page.split("\n").map((l) => l.trim()).filter(Boolean);
    const currency = pageLines[0]?.match(CURRENCY_LINE)?.[1];
    if (!currency) continue;
    const footer = pageLines.findIndex((l) => /^Page \d+\/\d+$/.test(l));
    const body = pageLines.slice(1, footer < 0 ? undefined : footer);
    const section = sections.get(currency) ?? { currency, opening: null as number | null, closing: null as number | null, entries: [] };
    sections.set(currency, section as StatementSection);
    parseBody(body, section as StatementSection & { opening: number | null; closing: number | null });
  }

  const out: StatementSection[] = [];
  for (const s of sections.values()) {
    if (s.opening === null || s.closing === null) throw new Error(`Couldn't find the opening or closing balance for ${s.currency}.`);
    const moved = s.entries.reduce((sum, e) => sum + e.credit - e.debit, 0);
    if (Math.abs(round2(s.opening + moved) - s.closing) >= 0.005) {
      throw new Error(
        `${s.currency}: opening ${s.opening.toFixed(2)} plus entries (${round2(moved).toFixed(2)}) doesn't equal closing ${s.closing.toFixed(2)}. The statement may not have been read correctly.`,
      );
    }
    out.push(s);
  }

  return {
    bank: "ANEXT",
    accountNumber,
    accountName: stmtIdx >= 0 ? lines[stmtIdx + 1] ?? "" : "",
    accountType: noIdx > 0 ? lines[noIdx - 1] : "",
    bankName: line(/(ANEXT Bank Pte\. Ltd\.)/i),
    accountLocation: line(/Incorporated in ([A-Za-z ]+?) with/),
    periodStart: isoDate(period[1], period[2], period[3]),
    periodEnd: isoDate(period[4], period[5], period[6]),
    sections: out,
  };
}

const ENTRY_START = new RegExp(`^${DATE} `);
const ENTRY = new RegExp(`^${DATE} (.*?) (-|${AMOUNT}) (-|${AMOUNT})(?: (${AMOUNT}))?$`);

function parseBody(body: string[], section: { opening: number | null; closing: number | null; entries: StatementEntry[] }) {
  // Join wrapped lines: an entry runs until the next dated line or a balance line.
  const chunks: string[] = [];
  for (const l of body) {
    if (/^Date Description/i.test(l) || /^Account Summary$/i.test(l)) continue;
    if (ENTRY_START.test(l) || /^(Opening Balance|Closing Balance|Total|Total Debit|Total Credit|of which)\b/i.test(l) || chunks.length === 0) {
      chunks.push(l);
    } else {
      chunks[chunks.length - 1] += " " + l;
    }
  }

  for (const c of chunks) {
    let m: RegExpMatchArray | null;
    if ((m = c.match(new RegExp(`^Opening Balance (${AMOUNT})$`, "i")))) {
      section.opening ??= amount(m[1]);
    } else if ((m = c.match(new RegExp(`^${DATE} Balance Brought Forward (${AMOUNT})$`, "i")))) {
      section.opening ??= amount(m[4]);
    } else if ((m = c.match(new RegExp(`^(?:Closing Balance|Total) (${AMOUNT})$`, "i")))) {
      section.closing = amount(m[1]);
    } else if ((m = c.match(ENTRY))) {
      const description = m[4].replace(/\s+/g, " ").trim();
      const debit = m[5] === "-" ? 0 : amount(m[5]);
      const credit = m[6] === "-" ? 0 : amount(m[6]);
      if (!debit && !credit) continue;
      section.entries.push({
        date: isoDate(m[1], m[2], m[3]),
        description,
        debit,
        credit,
        isInterest: /^Interest Earned$/i.test(description),
        counterparty: counterpartyOf(description),
      });
    }
  }
}
