"use server";

import { revalidatePath } from "next/cache";
import { logActivity } from "@/lib/activity";
import { applyCreditToNewInvoice } from "@/lib/credit";
import { prisma } from "@/lib/db";
import { authorize, requireAccess } from "@/lib/session";
import {
  approveReview,
  listMailbox,
  rejectReview,
  restoreReview,
  stageMailboxUids,
  stageSystemPdf,
  type MailboxScan,
  type StageOutcome,
} from "@/lib/system-import";

type Summary = { ok: true; outcomes: (StageOutcome & { label: string })[] } | { ok: false; error: string };

function refresh() {
  revalidatePath("/imports");
  revalidatePath("/invoices");
  revalidatePath("/dashboard");
  revalidatePath("/", "layout");
}

const errorText = (e: unknown) => (e instanceof Error ? e.message : "Mailbox fetch failed.");

/** Step 1 of a mailbox check: which emails are new, and which were handled before. */
export async function scanMailbox(): Promise<({ ok: true } & MailboxScan) | { ok: false; error: string }> {
  const auth = await authorize("systemImports", "EDIT");
  if (!auth.ok) return auth;
  try {
    return { ok: true, ...(await listMailbox()) };
  } catch (e) {
    return { ok: false, error: errorText(e) };
  }
}

/** Step 2, called repeatedly by the page with a few emails at a time so no single request runs long. */
export async function stageMailboxBatch(uids: number[]): Promise<Summary> {
  const auth = await authorize("systemImports", "EDIT");
  if (!auth.ok) return auth;
  try {
    const outcomes = await stageMailboxUids(uids.slice(0, 10));
    return { ok: true, outcomes: outcomes.map((o) => ({ ...o, label: o.subject })) };
  } catch (e) {
    return { ok: false, error: errorText(e) };
  }
}

export async function finishMailboxCheck() {
  await requireAccess("systemImports", "EDIT");
  refresh();
}

/** Multipart parsing hands over UTF-8 file names decoded as Latin-1 ("é¦æ¸¯…" for "香港…"); undo that when it round-trips cleanly. */
function uploadName(name: string) {
  if (!/[\u0080-\u00ff]/.test(name) || /[^\u0000-\u00ff]/.test(name)) return name;
  const utf8 = Buffer.from(name, "latin1").toString("utf8");
  return utf8.includes("\ufffd") ? name : utf8;
}

export async function uploadPdfs(form: FormData): Promise<Summary> {
  const auth = await authorize("systemImports", "EDIT");
  if (!auth.ok) return auth;
  const files = form.getAll("files").filter((f): f is File => f instanceof File && f.size > 0);
  if (!files.length) return { ok: false, error: "Choose one or more PDF files." };
  const outcomes: (StageOutcome & { label: string })[] = [];
  for (const f of files) {
    const name = uploadName(f.name);
    const outcome = await stageSystemPdf({ data: new Uint8Array(await f.arrayBuffer()), filename: name, subject: name });
    outcomes.push({ ...outcome, label: name });
  }
  await logActivity(auth.user, { action: "upload", entity: "import", label: outcomes.map((o) => o.label).join(", "), changes: { files: outcomes.length } });
  refresh();
  return { ok: true, outcomes };
}

/** Approves one item. The page calls this once per item, so "approve all" can show progress. */
export async function approveImport(id: string, clientId: string, refreshAfter = true): Promise<{ ok: true; number: string } | { ok: false; error: string }> {
  const auth = await authorize("systemImports", "EDIT");
  if (!auth.ok) return auth;
  const res = await approveReview(id, clientId, auth.user.id);
  if (res.ok) {
    await logActivity(auth.user, { action: "approve", entity: "import", entityId: id, label: res.number, changes: { invoiceId: res.invoiceId } });
    await logActivity(auth.user, { action: "import", entity: "invoice", entityId: res.invoiceId, label: res.number, changes: { source: "System import" } });
    await applyCreditToNewInvoice(res.invoiceId, auth.user);
  }
  if (refreshAfter) refresh();
  return res.ok ? { ok: true as const, number: res.number } : res;
}

async function importLabel(id: string) {
  const row = await prisma.importReview.findUnique({ where: { id }, select: { subject: true } });
  return row?.subject ?? "";
}

export async function rejectImport(id: string) {
  const user = await requireAccess("systemImports", "EDIT");
  await rejectReview(id, user.id);
  await logActivity(user, { action: "reject", entity: "import", entityId: id, label: await importLabel(id) });
  refresh();
}

export async function restoreImport(id: string) {
  const user = await requireAccess("systemImports", "EDIT");
  await restoreReview(id);
  await logActivity(user, { action: "restore", entity: "import", entityId: id, label: await importLabel(id) });
  refresh();
}
