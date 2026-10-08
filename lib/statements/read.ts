import { mergeMonths } from "./months";
import { parseStatement } from "./parse";
import type { ParsedStatement } from "./types";

export const MAX_FILES = 24;
export const MAX_BYTES = 10 * 1024 * 1024;

export type NamedStatement = { name: string; statement: ParsedStatement };
export type ReadError = { file: string; message: string };

/** Banks downloaded for a date range rather than as monthly statements. */
const RANGED: ParsedStatement["bank"][] = ["CIB", "AIRWALLEX"];

/** Parses uploaded statements into months. Date-range downloads of the same account are merged,
 *  so overlapping ranges give one copy of each transaction. */
export async function readStatementFiles(files: { name: string; data: Uint8Array }[]): Promise<{ parsed: NamedStatement[]; errors: ReadError[] }> {
  const errors: ReadError[] = [];
  const pdfs: NamedStatement[] = [];
  const ranged: NamedStatement[] = [];
  for (const f of files) {
    if (f.data.byteLength > MAX_BYTES) {
      errors.push({ file: f.name, message: "File is larger than 10 MB." });
      continue;
    }
    try {
      for (const statement of await parseStatement(f.data, f.name)) (RANGED.includes(statement.bank) ? ranged : pdfs).push({ name: f.name, statement });
    } catch (e) {
      errors.push({ file: f.name, message: e instanceof Error ? e.message : "Couldn't read this file." });
    }
  }

  // The same PDF statement uploaded twice would double its lines.
  const seen = new Set<string>();
  const parsed = pdfs.filter((p) => {
    const k = `${p.statement.bank}:${p.statement.accountNumber}:${p.statement.periodStart}`;
    if (seen.has(k)) {
      errors.push({ file: p.name, message: "Same statement as another file in this upload; skipped." });
      return false;
    }
    seen.add(k);
    return true;
  });

  for (const bank of RANGED) {
    const group = ranged.filter((r) => r.statement.bank === bank);
    if (!group.length) continue;
    try {
      for (const statement of mergeMonths(group.map((c) => c.statement))) {
        const ym = statement.periodStart.slice(0, 7);
        const currency = statement.sections[0].currency;
        const names = [
          ...new Set(
            group
              .filter((c) => c.statement.accountNumber === statement.accountNumber && c.statement.sections[0].currency === currency && c.statement.periodStart.startsWith(ym))
              .map((c) => c.name),
          ),
        ];
        parsed.push({ name: names.join(", "), statement });
      }
    } catch (e) {
      errors.push({ file: [...new Set(group.map((c) => c.name))].join(", "), message: e instanceof Error ? e.message : "Couldn't combine the downloads." });
    }
  }
  return { parsed, errors };
}
