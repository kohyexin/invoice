"use server";

import { revalidatePath } from "next/cache";
import { logActivity } from "@/lib/activity";
import { prisma } from "@/lib/db";
import { authorize } from "@/lib/session";
import { parseDateInput, round2 } from "@/lib/utils";

type Result = { ok: true } | { ok: false; error: string };

export type CashTxnInput = {
  date: string;
  /** yyyy-mm; blank means the month of `date`. */
  period: string;
  accountId: string;
  categoryId: string;
  purpose: string;
  party: string;
  memo: string;
  amountIn: string;
  amountOut: string;
  invoiceNumber: string;
};

function amount(raw: string) {
  const s = raw.replace(/,/g, "").trim();
  if (s === "") return 0;
  const n = Number(s);
  return Number.isFinite(n) ? round2(n) : NaN;
}

function refresh() {
  revalidatePath("/cash", "layout");
}

export async function saveCashTxn(id: string | null, input: CashTxnInput): Promise<Result> {
  const auth = await authorize("cashBook", "EDIT");
  if (!auth.ok) return auth;

  const date = parseDateInput(input.date);
  if (!date) return { ok: false, error: "Enter the date." };
  const pm = input.period.trim().match(/^(\d{4})-(\d{2})$/);
  if (input.period.trim() && !pm) return { ok: false, error: "Month used must be a month, e.g. 2026-08." };
  const period = pm
    ? new Date(Date.UTC(+pm[1], +pm[2] - 1, 1))
    : new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
  const amountIn = amount(input.amountIn);
  const amountOut = amount(input.amountOut);
  if (Number.isNaN(amountIn) || Number.isNaN(amountOut)) return { ok: false, error: "Amounts must be numbers." };
  if (amountIn < 0 || amountOut < 0) return { ok: false, error: "Enter amounts as positive numbers; use Money out for payments." };
  if (!amountIn && !amountOut) return { ok: false, error: "Enter money in or money out." };

  const account = await prisma.bankAccount.findUnique({ where: { id: input.accountId }, select: { id: true, use: true } });
  if (!account || account.use === "INVOICE") return { ok: false, error: "Pick a balance-sheet account." };

  const categoryId = input.categoryId || null;
  if (categoryId && !(await prisma.cashCategory.findUnique({ where: { id: categoryId }, select: { id: true } }))) {
    return { ok: false, error: "That category no longer exists." };
  }

  let invoiceId: string | null = null;
  const number = input.invoiceNumber.trim();
  if (number) {
    const inv = await prisma.invoice.findFirst({
      where: { number: { equals: number, mode: "insensitive" } },
      orderBy: { invoiceDate: "desc" },
      select: { id: true },
    });
    if (!inv) return { ok: false, error: `No invoice numbered ${number}.` };
    invoiceId = inv.id;
  }

  const data = {
    date,
    period,
    accountId: account.id,
    categoryId,
    purpose: input.purpose.trim(),
    party: input.party.trim(),
    memo: input.memo.trim(),
    amountIn,
    amountOut,
    invoiceId,
  };

  const label = [input.date, data.party || data.purpose].filter(Boolean).join(" · ");
  if (id) {
    const existing = await prisma.cashTxn.findUnique({ where: { id } });
    if (!existing) return { ok: false, error: "That line no longer exists." };
    const seq = existing.accountId === account.id ? existing.seq : await nextSeq(account.id);
    await prisma.cashTxn.update({ where: { id }, data: { ...data, seq } });
    await logActivity(auth.user, { action: "update", entity: "cash_entry", entityId: id, label, before: existing, after: data });
  } else {
    const row = await prisma.cashTxn.create({ data: { ...data, seq: await nextSeq(account.id) } });
    await logActivity(auth.user, { action: "create", entity: "cash_entry", entityId: row.id, label, after: data });
  }
  refresh();
  return { ok: true };
}

/** New lines sort after everything already on the account for the same day. */
async function nextSeq(accountId: string) {
  const max = await prisma.cashTxn.aggregate({ where: { accountId }, _max: { seq: true } });
  return (max._max.seq ?? 0) + 1;
}

export async function deleteCashTxn(id: string): Promise<Result> {
  const auth = await authorize("cashBook", "EDIT");
  if (!auth.ok) return auth;
  const before = await prisma.cashTxn.delete({ where: { id } }).catch(() => null);
  if (before)
    await logActivity(auth.user, {
      action: "delete",
      entity: "cash_entry",
      entityId: id,
      label: [before.date.toISOString().slice(0, 10), before.party || before.purpose].filter(Boolean).join(" · "),
      before,
    });
  refresh();
  return { ok: true };
}
