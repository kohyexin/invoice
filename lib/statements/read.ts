import { mergeCib } from "./cib";
import { parseStatement } from "./parse";
import type { ParsedStatement } from "./types";

export const MAX_FILES = 24;
export const MAX_BYTES = 10 * 1024 * 1024;

export type NamedStatement = { name: string; statement: ParsedStatement };
export type ReadError = { file: string; message: string };

/** Parses uploaded statements into months. Excel downloads of the same account are merged,
 *  so overlapping date ranges give one copy of each transaction. */
export async function readStatementFiles(files: { name: string; data: Uint8Array }[]): Promise<{ parsed: NamedStatement[]; errors: ReadError[] }> {
  const errors: ReadError[] = [];
  const pdfs: NamedStatement[] = [];
  const cib: NamedStatement[] = [];
  for (const f of files) {
    if (f.data.byteLength > MAX_BYTES) {
      errors.push({ file: f.name, message: "File is larger than 10 MB." });
      continue;
    }
    try {
      for (const statement of await parseStatement(f.data, f.name)) (statement.bank === "CIB" ? cib : pdfs).push({ name: f.name, statement });
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

  if (cib.length) {
    try {
      for (const statement of mergeCib(cib.map((c) => c.statement))) {
        const ym = statement.periodStart.slice(0, 7);
        const names = [...new Set(cib.filter((c) => c.statement.accountNumber === statement.accountNumber && c.statement.periodStart.startsWith(ym)).map((c) => c.name))];
        parsed.push({ name: names.join(", "), statement });
      }
    } catch (e) {
      errors.push({ file: [...new Set(cib.map((c) => c.name))].join(", "), message: e instanceof Error ? e.message : "Couldn't combine the downloads." });
    }
  }
  return { parsed, errors };
}
