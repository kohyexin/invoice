import "dotenv/config";
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { prisma } from "@/lib/db";
import { readStatementFiles } from "@/lib/statements/read";
import { reconcileStatements } from "@/lib/statements/reconcile";

/* Reads bank statements and compares them with the cash book without saving anything.

     npx tsx --conditions=react-server scripts/check-statement.ts <file> [more files…] */

async function main() {
  const paths = process.argv.slice(2);
  if (!paths.length) throw new Error("Pass one or more statement files.");
  const { parsed, errors } = await readStatementFiles(paths.map((p) => ({ name: basename(p), data: new Uint8Array(readFileSync(p)) })));
  for (const e of errors) console.log(`ERROR ${e.file}: ${e.message}`);

  for (const { statement: s } of parsed) {
    for (const sec of s.sections) {
      console.log(
        `${s.bank} ${s.accountNumber} ${sec.currency} ${s.periodStart}..${s.periodEnd}${s.partial ? " (partial)" : ""}  opening ${sec.opening.toFixed(2)}  closing ${sec.closing.toFixed(2)}  lines ${sec.entries.length}`,
      );
    }
  }

  const preview = await reconcileStatements(parsed);
  for (const m of preview.months) {
    console.log(`\n== ${m.id} -> ${m.accountLabel || "NOT LINKED"}`);
    console.log(`   book before ${m.baseOpening.toFixed(2)} vs bank opening ${m.opening.toFixed(2)}; book at end ${m.baseClosing.toFixed(2)} vs bank closing ${m.closing.toFixed(2)}`);
    console.log(`   after approval ${m.closingAfterApproval.toFixed(2)}; opening warning ${m.openingWarning ?? "none"}; waiting ${m.waiting}; rejected ${m.rejected}`);
    console.log(`   matched ${m.matched.length}, proposed ${m.proposed.length}, book-only ${m.bookOnly.length}`);
    for (const l of m.proposed) console.log(`     + ${l.date} ${l.kind.padEnd(8)} in ${l.amountIn.toFixed(2).padStart(12)} out ${l.amountOut.toFixed(2).padStart(12)}  ${l.counterparty} | ${l.description} [${l.suggested}] ${l.key}`);
    for (const b of m.bookOnly) console.log(`     ? book only ${b.date} ${b.net.toFixed(2)} ${b.purpose} ${b.party}`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
