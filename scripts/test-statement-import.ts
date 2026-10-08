import "dotenv/config";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { prisma } from "@/lib/db";
import { approveLine, stageStatements } from "@/lib/statements/queue";
import { readStatementFiles } from "@/lib/statements/read";
import { reconcileStatements } from "@/lib/statements/reconcile";

/* A real Industrial Bank (XMXY) import through the same code as the upload page, and
   a way to undo it so the import can be tried again by hand.

     npx tsx --conditions=react-server scripts/test-statement-import.ts <file.xls>   import, approve one line, re-run
     npx tsx --conditions=react-server scripts/test-statement-import.ts --revert     put the database back

   Only Industrial Bank rows (keys starting "CIB:") are written or removed. */

const SNAPSHOT = join(__dirname, ".snapshots", "cib-test.json");
const PREFIX = "CIB:";

type Snapshot = { accountIds: string[]; balances: Record<string, string>; hints: Record<string, unknown>[] };

async function balances(accountIds: string[]) {
  const out: Record<string, string> = {};
  for (const id of accountIds) {
    const s = await prisma.cashTxn.aggregate({ where: { accountId: id }, _sum: { amountIn: true, amountOut: true } });
    out[id] = (Number(s._sum.amountIn ?? 0) - Number(s._sum.amountOut ?? 0)).toFixed(2);
  }
  return out;
}

async function stage(path: string) {
  const { parsed, errors } = await readStatementFiles([{ name: basename(path), data: new Uint8Array(readFileSync(path)) }]);
  if (errors.length) throw new Error(errors.map((e) => `${e.file}: ${e.message}`).join("\n"));
  const preview = await reconcileStatements(parsed);
  const res = await stageStatements(preview, null);
  return { ...res, preview };
}

async function runImport(path: string) {
  if (existsSync(SNAPSHOT)) throw new Error("A test import is already in place. Run --revert first.");
  if (await prisma.statementImport.count({ where: { id: { startsWith: PREFIX } } })) {
    throw new Error("Industrial Bank statements are already in the database; not testing over real data.");
  }

  const { parsed } = await readStatementFiles([{ name: basename(path), data: new Uint8Array(readFileSync(path)) }]);
  const preview = await reconcileStatements(parsed);
  const accountIds = [...new Set(preview.months.map((m) => m.accountId).filter((id): id is string => !!id))];
  if (!accountIds.length) throw new Error("The statement isn't linked to an account in Settings.");
  const snapshot: Snapshot = {
    accountIds,
    balances: await balances(accountIds),
    hints: await prisma.cashHint.findMany({ where: { accountId: { in: accountIds } } }),
  };
  mkdirSync(join(__dirname, ".snapshots"), { recursive: true });
  writeFileSync(SNAPSHOT, JSON.stringify(snapshot, null, 2));
  console.log(`Snapshot saved: ${snapshot.hints.length} hints, balances ${JSON.stringify(snapshot.balances)}`);

  const first = await stage(path);
  console.log(`Staged ${first.months} month(s), queued ${first.queued} line(s).`);

  const line = await prisma.statementLine.findFirst({ where: { key: { startsWith: PREFIX }, status: "PENDING" }, orderBy: { date: "asc" } });
  if (line) {
    await approveLine(
      line.id,
      {
        date: line.date.toISOString().slice(0, 10),
        period: (line.period ?? line.date).toISOString().slice(0, 7),
        categoryId: line.categoryId ?? "",
        purpose: line.purpose,
        party: line.party,
        memo: line.memo,
      },
      null,
    );
    const txn = await prisma.cashTxn.findUnique({ where: { importKey: line.key } });
    console.log(`Approved ${line.key}: cash book line ${txn ? "created" : "MISSING"} (${line.date.toISOString().slice(0, 10)}, in ${line.amountIn}, out ${line.amountOut}).`);
  }

  const second = await stage(path);
  console.log(`Second run of the same file queued ${second.queued} line(s) (expected 0).`);
  const statuses = await prisma.statementLine.groupBy({ by: ["status"], where: { key: { startsWith: PREFIX } }, _count: true });
  console.log("Industrial Bank lines by status:", Object.fromEntries(statuses.map((s) => [s.status, s._count])));
  console.log(`Balances now ${JSON.stringify(await balances(accountIds))}`);
}

async function revert() {
  if (!existsSync(SNAPSHOT)) throw new Error("No test import snapshot found; nothing to revert.");
  const snapshot = JSON.parse(readFileSync(SNAPSHOT, "utf8")) as Snapshot;
  const counts = await prisma.$transaction(async (tx) => {
    const txns = await tx.cashTxn.deleteMany({ where: { importKey: { startsWith: PREFIX } } });
    const lines = await tx.statementLine.deleteMany({ where: { key: { startsWith: PREFIX } } });
    const statements = await tx.statementImport.deleteMany({ where: { id: { startsWith: PREFIX } } });
    await tx.cashHint.deleteMany({ where: { accountId: { in: snapshot.accountIds } } });
    if (snapshot.hints.length) await tx.cashHint.createMany({ data: snapshot.hints as never });
    return { txns: txns.count, lines: lines.count, statements: statements.count };
  });
  console.log(`Removed ${counts.txns} cash book line(s), ${counts.lines} statement line(s), ${counts.statements} statement month(s); restored ${snapshot.hints.length} hints.`);
  const now = await balances(snapshot.accountIds);
  const same = JSON.stringify(now) === JSON.stringify(snapshot.balances);
  console.log(`Balances ${JSON.stringify(now)} ${same ? "match" : "DO NOT match"} the snapshot.`);
  if (!same) throw new Error("Balances differ from before the test.");
  renameSync(SNAPSHOT, `${SNAPSHOT}.reverted`);
}

const arg = process.argv[2];
(arg === "--revert" ? revert() : arg ? runImport(arg) : Promise.reject(new Error("Pass a statement file or --revert.")))
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
