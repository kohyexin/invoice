"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { fetchMailbox, importSystemPdf, type ImportOutcome } from "@/lib/system-import";

type Summary = { ok: true; outcomes: (ImportOutcome & { label: string })[] } | { ok: false; error: string };

function refresh() {
  revalidatePath("/imports");
  revalidatePath("/invoices");
  revalidatePath("/dashboard");
  revalidatePath("/", "layout");
}

export async function checkMailbox(): Promise<Summary> {
  try {
    const outcomes = await fetchMailbox();
    refresh();
    return { ok: true, outcomes: outcomes.map((o) => ({ ...o, label: o.subject })) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Mailbox fetch failed." };
  }
}

export async function uploadPdfs(form: FormData): Promise<Summary> {
  const files = form.getAll("files").filter((f): f is File => f instanceof File && f.size > 0);
  if (!files.length) return { ok: false, error: "Choose one or more PDF files." };
  const outcomes: (ImportOutcome & { label: string })[] = [];
  for (const f of files) {
    const outcome = await importSystemPdf({ data: new Uint8Array(await f.arrayBuffer()), filename: f.name, subject: f.name });
    outcomes.push({ ...outcome, label: f.name });
  }
  refresh();
  return { ok: true, outcomes };
}

export async function resolveReview(id: string, clientId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const row = await prisma.importReview.findUnique({ where: { id } });
  if (!row?.pdf) return { ok: false, error: "The PDF for this item is missing." };
  if (!clientId) return { ok: false, error: "Pick a client." };
  const outcome = await importSystemPdf(
    { data: new Uint8Array(row.pdf), filename: row.filename, messageId: row.messageId, subject: row.subject, receivedAt: row.receivedAt },
    clientId
  );
  refresh();
  if (outcome.status === "imported" || outcome.status === "duplicate") return { ok: true };
  return { ok: false, error: outcome.status === "review" ? outcome.reason : outcome.reason };
}

export async function dismissReview(id: string) {
  await prisma.importReview.update({ where: { id }, data: { status: "DISMISSED" } });
  refresh();
}
