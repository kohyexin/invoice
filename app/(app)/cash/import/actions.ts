"use server";

import { revalidatePath } from "next/cache";
import { logActivity } from "@/lib/activity";
import { prisma } from "@/lib/db";
import { authorize } from "@/lib/session";
import { approveLine, rejectLine, restoreLine, saveLine, stageStatements, type LineEdits } from "@/lib/statements/queue";
import { MAX_FILES, readStatementFiles } from "@/lib/statements/read";
import { reconcileStatements, type StatementPreview } from "@/lib/statements/reconcile";

type Result = { ok: true } | { ok: false; error: string };

function refresh() {
  revalidatePath("/cash", "layout");
  revalidatePath("/", "layout");
}

const errorText = (e: unknown, fallback: string) => (e instanceof Error ? e.message : fallback);

/** A statement line as the activity log describes it, with the editable fields to diff. */
async function lineForLog(id: string) {
  const l = await prisma.statementLine.findUnique({ where: { id }, include: { account: { select: { label: true } } } });
  if (!l) return null;
  const amount = Number(l.amountIn) ? `+${l.amountIn}` : `-${l.amountOut}`;
  return {
    label: [l.account.label, l.date.toISOString().slice(0, 10), amount, l.description].filter(Boolean).join(" · "),
    fields: { date: l.date.toISOString().slice(0, 10), categoryId: l.categoryId ?? "", purpose: l.purpose, party: l.party, memo: l.memo },
  };
}

async function readFiles(form: FormData) {
  const files = form.getAll("files").filter((f): f is File => f instanceof File && f.size > 0);
  if (!files.length) throw new Error("Choose at least one statement file.");
  if (files.length > MAX_FILES) throw new Error(`Upload at most ${MAX_FILES} statements at a time.`);
  return readStatementFiles(await Promise.all(files.map(async (f) => ({ name: f.name, data: new Uint8Array(await f.arrayBuffer()) }))));
}

export type UploadChoices = {
  /** "accountNumber:currency" -> bank account id, for statements not yet linked in Settings. */
  accounts?: Record<string, string>;
  /** Account id -> detail field keys to copy from the statement. */
  details?: Record<string, string[]>;
};

function choicesFrom(form: FormData) {
  try {
    return JSON.parse(String(form.get("choices") ?? "{}")) as UploadChoices;
  } catch {
    return {} as UploadChoices;
  }
}

export type UploadResult = ({ ok: true; queued: number } & StatementPreview) | { ok: false; error: string };

/** Checks the statements against the cash book and queues what is missing for approval. */
export async function uploadStatements(form: FormData): Promise<UploadResult> {
  const auth = await authorize("statementImport", "EDIT");
  if (!auth.ok) return auth;
  try {
    const { parsed, errors } = await readFiles(form);
    const preview = await reconcileStatements(parsed, choicesFrom(form).accounts);
    const { queued } = await stageStatements(preview, auth.user.id);
    const names = [...new Set(parsed.flatMap((p) => p.name.split(", ")))];
    await logActivity(auth.user, { action: "upload", entity: "statement", label: names.join(", "), changes: { files: names.length, months: parsed.length, queued } });
    refresh();
    return { ok: true, queued, ...preview, errors };
  } catch (e) {
    return { ok: false, error: errorText(e, "Couldn't read the statements.") };
  }
}

/** Copies the ticked account details from the statements to Settings. */
export async function copyAccountDetails(form: FormData): Promise<({ ok: true; updated: number }) | { ok: false; error: string }> {
  const auth = await authorize("statementImport", "EDIT");
  if (!auth.ok) return auth;
  try {
    const choices = choicesFrom(form);
    const { parsed } = await readFiles(form);
    const preview = await reconcileStatements(parsed, choices.accounts);
    const updates = preview.accounts
      .map((a) => {
        const ticked = new Set(choices.details?.[a.accountId] ?? []);
        const set: Record<string, string> = {};
        for (const f of a.fields) if (ticked.has(f.key) && f.statement) set[f.key] = f.statement;
        return { id: a.accountId, set };
      })
      .filter((u) => Object.keys(u.set).length > 0);
    const before = await prisma.bankAccount.findMany({ where: { id: { in: updates.map((u) => u.id) } } });
    await prisma.$transaction(updates.map((u) => prisma.bankAccount.update({ where: { id: u.id }, data: u.set })));
    for (const u of updates) {
      const b = before.find((x) => x.id === u.id);
      await logActivity(auth.user, { action: "update", entity: "setting:bankAccount", entityId: u.id, label: b?.label ?? "", before: b, after: u.set });
    }
    refresh();
    revalidatePath("/settings");
    return { ok: true, updated: updates.length };
  } catch (e) {
    return { ok: false, error: errorText(e, "Couldn't update Settings.") };
  }
}

export async function saveStatementLine(id: string, edits: LineEdits): Promise<Result> {
  const auth = await authorize("statementImport", "EDIT");
  if (!auth.ok) return auth;
  try {
    const line = await lineForLog(id);
    await saveLine(id, edits);
    if (line) await logActivity(auth.user, { action: "update", entity: "statement_line", entityId: id, label: line.label, before: line.fields, after: edits });
    revalidatePath("/cash/import");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: errorText(e, "Couldn't save the line.") };
  }
}

export async function approveStatementLine(id: string, edits: LineEdits, refreshAfter = true): Promise<Result> {
  const auth = await authorize("statementImport", "EDIT");
  if (!auth.ok) return auth;
  try {
    const line = await lineForLog(id);
    await approveLine(id, edits, auth.user.id);
    if (line) await logActivity(auth.user, { action: "approve", entity: "statement_line", entityId: id, label: line.label, before: line.fields, after: edits });
    if (refreshAfter) refresh();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: errorText(e, "Couldn't approve the line.") };
  }
}

export async function rejectStatementLine(id: string): Promise<Result> {
  const auth = await authorize("statementImport", "EDIT");
  if (!auth.ok) return auth;
  try {
    await rejectLine(id, auth.user.id);
    const line = await lineForLog(id);
    await logActivity(auth.user, { action: "reject", entity: "statement_line", entityId: id, label: line?.label });
    refresh();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: errorText(e, "Couldn't reject the line.") };
  }
}

export async function restoreStatementLine(id: string): Promise<Result> {
  const auth = await authorize("statementImport", "EDIT");
  if (!auth.ok) return auth;
  try {
    await restoreLine(id);
    const line = await lineForLog(id);
    await logActivity(auth.user, { action: "restore", entity: "statement_line", entityId: id, label: line?.label });
    refresh();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: errorText(e, "Couldn't restore the line.") };
  }
}

/** After "Approve all": one refresh instead of one per line. */
export async function finishStatementApprovals() {
  const auth = await authorize("statementImport", "EDIT");
  if (auth.ok) refresh();
}
