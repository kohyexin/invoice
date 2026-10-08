import "dotenv/config";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { prisma } from "@/lib/db";
import { applyPayment, creditBalance } from "@/lib/credit";
import { approveLine, stageStatements, type LineEdits } from "@/lib/statements/queue";
import { readStatementFiles } from "@/lib/statements/read";
import { reconcileStatements } from "@/lib/statements/reconcile";
import { round2 } from "@/lib/utils";

/* A real statement import (Industrial Bank Excel or Airwallex CSV) through the same code
   as the upload page, and a way to undo it so the import can be tried again by hand.

     npx tsx --conditions=react-server scripts/test-statement-import.ts <file>                  import, approve a few lines, re-run
     npx tsx --conditions=react-server scripts/test-statement-import.ts --revert [CIB|AIRWALLEX] put the database back

   Only rows of that bank (keys starting "CIB:" or "AIRWALLEX:") are written or removed;
   invoices paid by a test approval are put back and their client credit removed. */

const snapshotFile = (bank: string) => join(__dirname, ".snapshots", `${bank.toLowerCase()}-test.json`);
const INVOICE_FIELDS = ["status", "amountPaid", "receivedDate", "receivedAmount", "receivedCurrency", "fee", "paymentNote", "updatedById"] as const;

type Snapshot = {
  bank: string;
  accountIds: string[];
  balances: Record<string, string>;
  hints: Record<string, unknown>[];
  invoices: Record<string, unknown>[];
};

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

type Line = NonNullable<Awaited<ReturnType<typeof prisma.statementLine.findFirst>>>;
const editsOf = (line: Line): LineEdits => ({
  date: line.date.toISOString().slice(0, 10),
  period: (line.period ?? line.date).toISOString().slice(0, 7),
  categoryId: line.categoryId ?? "",
  purpose: line.purpose,
  party: line.party,
  memo: line.memo,
  clientId: line.clientId ?? "",
  invoiceIds: (line.invoiceIds as string[] | null) ?? [],
});

async function anyCategory(accountId: string, money: "in" | "out") {
  const txn = await prisma.cashTxn.findFirst({
    where: { accountId, categoryId: { not: null }, ...(money === "in" ? { amountIn: { gt: 0 } } : { amountOut: { gt: 0 } }) },
    orderBy: { date: "desc" },
    select: { categoryId: true },
  });
  return txn?.categoryId ?? (await prisma.cashCategory.findFirstOrThrow({ where: { active: true }, select: { id: true } })).id;
}

async function runImport(path: string) {
  const { parsed } = await readStatementFiles([{ name: basename(path), data: new Uint8Array(readFileSync(path)) }]);
  const bank = parsed[0]?.statement.bank;
  if (!bank) throw new Error("No statement read from the file.");
  const prefix = `${bank}:`;
  const file = snapshotFile(bank);
  if (existsSync(file)) throw new Error("A test import is already in place. Run --revert first.");
  if (await prisma.statementImport.count({ where: { id: { startsWith: prefix } } })) {
    throw new Error(`${bank} statements are already in the database; not testing over real data.`);
  }

  const preview = await reconcileStatements(parsed);
  const accountIds = [...new Set(preview.months.map((m) => m.accountId).filter((id): id is string => !!id))];
  if (!accountIds.length) throw new Error("The statement isn't linked to an account in Settings.");
  const snapshot: Snapshot = {
    bank,
    accountIds,
    balances: await balances(accountIds),
    hints: await prisma.cashHint.findMany({ where: { accountId: { in: accountIds } } }),
    invoices: [],
  };
  mkdirSync(join(__dirname, ".snapshots"), { recursive: true });
  const save = () => writeFileSync(file, JSON.stringify(snapshot, null, 2));
  save();
  console.log(`Snapshot saved: ${snapshot.hints.length} hints, balances ${JSON.stringify(snapshot.balances)}`);

  const first = await stage(path);
  console.log(`Staged ${first.months} month(s), queued ${first.queued} line(s).`);

  const pending = await prisma.statementLine.findMany({ where: { key: { startsWith: prefix }, status: "PENDING" }, orderBy: [{ date: "asc" }, { key: "asc" }] });
  const touched = [...new Set(pending.flatMap((l) => (l.invoiceIds as string[] | null) ?? []))];
  snapshot.invoices = await prisma.invoice.findMany({ where: { id: { in: touched } }, select: { id: true, ...Object.fromEntries(INVOICE_FIELDS.map((f) => [f, true])) } });
  save();

  const approve = async (line: Line, edits: LineEdits, label: string) => {
    const res = await approveLine(line.id, edits, null, { markPaid: true });
    const txns = await prisma.cashTxn.findMany({ where: { importKey: { startsWith: line.key } }, select: { importKey: true, amountIn: true, amountOut: true, invoiceId: true } });
    console.log(`${label}: ${txns.map((t) => `${t.importKey!.slice(line.key.length) || "main"} in ${t.amountIn} out ${t.amountOut}`).join("; ")}`);
    if (res.settled.length) console.log(`   settled ${res.settled.map((s) => s.number).join(", ")}`);
    for (const p of res.payments) console.log(`   paid ${p.paid.map((x) => x.number).join(", ") || "nothing"}; credit used ${p.fromCredit}, added ${p.leftOver}`);
  };

  // A plain line, as suggested.
  const plain = pending.find((l) => !l.splits && !(l.invoiceIds as string[] | null)?.length && l.categoryId);
  if (plain) await approve(plain, editsOf(plain), `Approved ${plain.counterparty || plain.description}`);

  // A payment split into two rows, remembered for the payee.
  const toSplit = pending.find((l) => l !== plain && Number(l.amountOut) >= 2 && !l.splits);
  if (toSplit) {
    const categoryId = toSplit.categoryId || (await anyCategory(toSplit.accountId, "out"));
    const out = Number(toSplit.amountOut);
    const part = round2(out / 2);
    const row = (amountOut: number, memo: string) => ({ categoryId, purpose: toSplit.purpose || "Test", party: toSplit.party, memo, amountIn: 0, amountOut });
    await approve(toSplit, { ...editsOf(toSplit), categoryId, splits: [row(round2(out - part), "Split test A"), row(part, "Split test B")] }, `Split ${toSplit.counterparty}`);
    const hint = await prisma.cashHint.findFirst({ where: { accountId: toSplit.accountId, counterparty: toSplit.counterparty, direction: "out" }, select: { splits: true } });
    console.log(`   hint remembers ${Array.isArray(hint?.splits) ? hint.splits.length : 0} split rows`);
  }

  // A receipt paying the suggested invoices through client credit.
  const receipt = pending.find((l) => ((l.invoiceIds as string[] | null) ?? []).length > 0);
  if (receipt) {
    const edits = editsOf(receipt);
    if (!edits.categoryId) edits.categoryId = await anyCategory(receipt.accountId, "in");
    await approve(receipt, edits, `Receipt ${receipt.counterparty} (${receipt.party})`);
  }

  const second = await stage(path);
  console.log(`Second run of the same file queued ${second.queued} line(s) (expected 0).`);
  for (const m of second.preview.months) if (m.accountId) console.log(`   ${m.id}: book ${m.baseClosing.toFixed(2)} after approval ${m.closingAfterApproval.toFixed(2)} bank ${m.closing.toFixed(2)}`);
  const statuses = await prisma.statementLine.groupBy({ by: ["status"], where: { key: { startsWith: prefix } }, _count: true });
  console.log(`${bank} lines by status:`, Object.fromEntries(statuses.map((s) => [s.status, s._count])));
  console.log(`Balances now ${JSON.stringify(await balances(accountIds))}`);
}

/** Overpaying, then paying short from that credit, inside a transaction that is rolled back. */
async function creditCheck() {
  const ROLLBACK = "rollback";
  const open = await prisma.invoice.findMany({ where: { status: "SENT", currency: "USD" }, orderBy: { invoiceDate: "asc" }, select: { id: true, clientId: true, number: true, amount: true, amountPaid: true } });
  const byClient = new Map<string, typeof open>();
  for (const i of open) byClient.set(i.clientId, [...(byClient.get(i.clientId) ?? []), i]);
  const pair = [...byClient.values()].find((l) => l.length >= 2);
  if (!pair) return console.log("Credit check skipped: no client with two unpaid USD invoices.");
  const [a, b] = pair;
  const due = (i: (typeof open)[number]) => round2(Number(i.amount) - Number(i.amountPaid));
  await prisma
    .$transaction(async (tx) => {
      const start = await creditBalance(tx, a.clientId, "USD");
      const over = await applyPayment(tx, { clientId: a.clientId, currency: "USD", date: new Date(), amount: due(a) + 100, fee: 0, invoiceIds: [a.id], note: "", actorId: null });
      const short = await applyPayment(tx, { clientId: a.clientId, currency: "USD", date: new Date(), amount: due(b) - 60, fee: 0, invoiceIds: [b.id], note: "", actorId: null });
      const end = await creditBalance(tx, a.clientId, "USD");
      console.log(`Credit check: overpay ${a.number} added ${over.leftOver}; short ${b.number} used ${short.fromCredit}; credit ${start} -> ${end} (expected ${round2(start + 40)})`);
      let refused = false;
      try {
        await applyPayment(tx, { clientId: a.clientId, currency: "USD", date: new Date(), amount: 1, fee: 0, invoiceIds: pair.slice(2, 3).map((i) => i.id), note: "", actorId: null });
      } catch {
        refused = true;
      }
      if (pair.length > 2) console.log(`   paying a third invoice with 1.00 and ${end} credit was ${refused ? "refused" : "ALLOWED"}`);
      throw new Error(ROLLBACK);
    })
    .catch((e) => {
      if (!(e instanceof Error && e.message === ROLLBACK)) throw e;
    });
  console.log(`   rolled back; ${a.number} status now ${(await prisma.invoice.findUnique({ where: { id: a.id }, select: { status: true } }))?.status}`);
}

async function revert(bankArg?: string) {
  const bank = bankArg ?? ["CIB", "AIRWALLEX"].find((b) => existsSync(snapshotFile(b)));
  const file = bank ? snapshotFile(bank) : "";
  if (!bank || !existsSync(file)) throw new Error("No test import snapshot found; nothing to revert.");
  const snapshot = JSON.parse(readFileSync(file, "utf8")) as Snapshot;
  const prefix = `${bank}:`;
  const counts = await prisma.$transaction(async (tx) => {
    const ids = (await tx.cashTxn.findMany({ where: { importKey: { startsWith: prefix } }, select: { id: true } })).map((t) => t.id);
    const credits = await tx.clientCredit.deleteMany({ where: { cashTxnId: { in: ids } } });
    for (const inv of snapshot.invoices ?? []) {
      const { id, ...fields } = inv as { id: string } & Record<string, unknown>;
      await tx.invoice.update({ where: { id }, data: fields });
    }
    const txns = await tx.cashTxn.deleteMany({ where: { id: { in: ids } } });
    const lines = await tx.statementLine.deleteMany({ where: { key: { startsWith: prefix } } });
    const statements = await tx.statementImport.deleteMany({ where: { id: { startsWith: prefix } } });
    await tx.cashHint.deleteMany({ where: { accountId: { in: snapshot.accountIds } } });
    if (snapshot.hints.length) await tx.cashHint.createMany({ data: snapshot.hints as never });
    return { txns: txns.count, lines: lines.count, statements: statements.count, credits: credits.count };
  });
  console.log(
    `Removed ${counts.txns} cash book line(s), ${counts.lines} statement line(s), ${counts.statements} statement month(s), ${counts.credits} credit row(s); restored ${snapshot.hints.length} hints and ${snapshot.invoices?.length ?? 0} invoice(s).`,
  );
  const now = await balances(snapshot.accountIds);
  const same = JSON.stringify(now) === JSON.stringify(snapshot.balances);
  console.log(`Balances ${JSON.stringify(now)} ${same ? "match" : "DO NOT match"} the snapshot.`);
  if (!same) throw new Error("Balances differ from before the test.");
  renameSync(file, `${file}.reverted`);
}

const [arg, extra] = process.argv.slice(2);
(arg === "--revert" ? revert(extra) : arg === "--credit" ? creditCheck() : arg ? runImport(arg) : Promise.reject(new Error("Pass a statement file, --credit or --revert.")))
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
