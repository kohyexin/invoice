"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { authorize } from "@/lib/session";
import { parseStatement } from "@/lib/statements/parse";
import { approveLine, rejectLine, restoreLine, saveLine, stageStatements, type LineEdits } from "@/lib/statements/queue";
import { reconcileStatements, type StatementPreview } from "@/lib/statements/reconcile";
import type { ParsedStatement } from "@/lib/statements/types";

const MAX_FILES = 24;
const MAX_BYTES = 10 * 1024 * 1024;

type Result = { ok: true } | { ok: false; error: string };

function refresh() {
  revalidatePath("/cash", "layout");
  revalidatePath("/", "layout");
}

const errorText = (e: unknown, fallback: string) => (e instanceof Error ? e.message : fallback);

async function readFiles(form: FormData) {
  const files = form.getAll("files").filter((f): f is File => f instanceof File && f.size > 0);
  if (!files.length) throw new Error("Choose at least one statement PDF.");
  if (files.length > MAX_FILES) throw new Error(`Upload at most ${MAX_FILES} statements at a time.`);
  const parsed: { name: string; statement: ParsedStatement }[] = [];
  const errors: StatementPreview["errors"] = [];
  for (const f of files) {
    if (f.size > MAX_BYTES) {
      errors.push({ file: f.name, message: "File is larger than 10 MB." });
      continue;
    }
    try {
      parsed.push({ name: f.name, statement: await parseStatement(new Uint8Array(await f.arrayBuffer())) });
    } catch (e) {
      errors.push({ file: f.name, message: errorText(e, "Couldn't read this file.") });
    }
  }
  // The same statement uploaded twice would double its lines.
  const seen = new Set<string>();
  const unique = parsed.filter((p) => {
    const k = `${p.statement.bank}:${p.statement.accountNumber}:${p.statement.periodStart}`;
    if (seen.has(k)) {
      errors.push({ file: p.name, message: "Same statement as another file in this upload; skipped." });
      return false;
    }
    seen.add(k);
    return true;
  });
  return { parsed: unique, errors };
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
  const auth = await authorize("STAFF");
  if (!auth.ok) return auth;
  try {
    const { parsed, errors } = await readFiles(form);
    const preview = await reconcileStatements(parsed, choicesFrom(form).accounts);
    const { queued } = await stageStatements(preview, auth.user.id);
    refresh();
    return { ok: true, queued, ...preview, errors };
  } catch (e) {
    return { ok: false, error: errorText(e, "Couldn't read the statements.") };
  }
}

/** Copies the ticked account details from the statements to Settings. */
export async function copyAccountDetails(form: FormData): Promise<({ ok: true; updated: number }) | { ok: false; error: string }> {
  const auth = await authorize("STAFF");
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
    await prisma.$transaction(updates.map((u) => prisma.bankAccount.update({ where: { id: u.id }, data: u.set })));
    refresh();
    revalidatePath("/settings");
    return { ok: true, updated: updates.length };
  } catch (e) {
    return { ok: false, error: errorText(e, "Couldn't update Settings.") };
  }
}

export async function saveStatementLine(id: string, edits: LineEdits): Promise<Result> {
  const auth = await authorize("STAFF");
  if (!auth.ok) return auth;
  try {
    await saveLine(id, edits);
    revalidatePath("/cash/import");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: errorText(e, "Couldn't save the line.") };
  }
}

export async function approveStatementLine(id: string, edits: LineEdits, refreshAfter = true): Promise<Result> {
  const auth = await authorize("STAFF");
  if (!auth.ok) return auth;
  try {
    await approveLine(id, edits, auth.user.id);
    if (refreshAfter) refresh();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: errorText(e, "Couldn't approve the line.") };
  }
}

export async function rejectStatementLine(id: string): Promise<Result> {
  const auth = await authorize("STAFF");
  if (!auth.ok) return auth;
  try {
    await rejectLine(id, auth.user.id);
    refresh();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: errorText(e, "Couldn't reject the line.") };
  }
}

export async function restoreStatementLine(id: string): Promise<Result> {
  const auth = await authorize("STAFF");
  if (!auth.ok) return auth;
  try {
    await restoreLine(id);
    refresh();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: errorText(e, "Couldn't restore the line.") };
  }
}

/** After "Approve all": one refresh instead of one per line. */
export async function finishStatementApprovals() {
  const auth = await authorize("STAFF");
  if (auth.ok) refresh();
}
