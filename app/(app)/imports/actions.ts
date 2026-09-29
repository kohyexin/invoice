"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { authorize, requireRole } from "@/lib/session";
import { importMailboxUids, importSystemPdf, listMailbox, type ImportOutcome, type MailboxItem } from "@/lib/system-import";

type Summary = { ok: true; outcomes: (ImportOutcome & { label: string })[] } | { ok: false; error: string };

function refresh() {
  revalidatePath("/imports");
  revalidatePath("/invoices");
  revalidatePath("/dashboard");
  revalidatePath("/", "layout");
}

const errorText = (e: unknown) => (e instanceof Error ? e.message : "Mailbox fetch failed.");

/** Step 1 of a mailbox check: which emails still need importing. */
export async function scanMailbox(): Promise<{ ok: true; items: MailboxItem[]; alreadyDone: number } | { ok: false; error: string }> {
  const auth = await authorize("STAFF");
  if (!auth.ok) return auth;
  try {
    return { ok: true, ...(await listMailbox()) };
  } catch (e) {
    return { ok: false, error: errorText(e) };
  }
}

/** Step 2, called repeatedly by the page with a few emails at a time so no single request runs long. */
export async function importMailboxBatch(uids: number[]): Promise<Summary> {
  const auth = await authorize("STAFF");
  if (!auth.ok) return auth;
  try {
    const outcomes = await importMailboxUids(uids.slice(0, 10), auth.user.id);
    return { ok: true, outcomes: outcomes.map((o) => ({ ...o, label: o.subject })) };
  } catch (e) {
    return { ok: false, error: errorText(e) };
  }
}

export async function finishMailboxCheck() {
  await requireRole("STAFF");
  refresh();
}

export async function uploadPdfs(form: FormData): Promise<Summary> {
  const auth = await authorize("STAFF");
  if (!auth.ok) return auth;
  const files = form.getAll("files").filter((f): f is File => f instanceof File && f.size > 0);
  if (!files.length) return { ok: false, error: "Choose one or more PDF files." };
  const outcomes: (ImportOutcome & { label: string })[] = [];
  for (const f of files) {
    const outcome = await importSystemPdf(
      { data: new Uint8Array(await f.arrayBuffer()), filename: f.name, subject: f.name },
      undefined,
      auth.user.id
    );
    outcomes.push({ ...outcome, label: f.name });
  }
  refresh();
  return { ok: true, outcomes };
}

export async function resolveReview(id: string, clientId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const auth = await authorize("STAFF");
  if (!auth.ok) return auth;
  const row = await prisma.importReview.findUnique({ where: { id } });
  if (!row?.pdf) return { ok: false, error: "The PDF for this item is missing." };
  if (!clientId) return { ok: false, error: "Pick a client." };
  const outcome = await importSystemPdf(
    { data: new Uint8Array(row.pdf), filename: row.filename, messageId: row.messageId, subject: row.subject, receivedAt: row.receivedAt },
    clientId,
    auth.user.id
  );
  refresh();
  if (outcome.status === "imported" || outcome.status === "duplicate") return { ok: true };
  return { ok: false, error: outcome.reason };
}

export async function dismissReview(id: string) {
  await requireRole("STAFF");
  await prisma.importReview.update({ where: { id }, data: { status: "DISMISSED" } });
  refresh();
}
