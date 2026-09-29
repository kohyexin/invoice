import "server-only";
import { createHash } from "node:crypto";
import { prisma } from "@/lib/db";
import { downloadFile, driveConfigured, getDriveConnection, monthFolder, trashFile, updateFile, uploadFile } from "@/lib/gdrive";
import { draftForInvoice, pdfDataFromDraft, renderInvoicePdf } from "@/lib/pdf/render";

/* The PDF of record for each invoice. Generated invoices are frozen when
 * issued; imported ones keep the billing system's PDF. Both are archived on
 * Google Drive as <year>/<year-month>/<number> <alias>.pdf, and the local copy
 * is dropped only after Drive confirms the upload. */

const errText = (e: unknown) => (e instanceof Error ? e.message : "Upload failed.");

export function archiveName(number: string, alias: string) {
  const clean = (s: string) => s.replace(/[\\/:*?"<>|]+/g, "_").trim();
  return `${clean(number)}${alias ? ` ${clean(alias)}` : ""}.pdf`;
}

async function driveReady() {
  return driveConfigured() && Boolean(await getDriveConnection());
}

/** Renders and saves the PDF of an app-generated invoice, replacing any earlier version. */
export async function freezeGeneratedPdf(invoiceId: string) {
  const draft = await draftForInvoice(invoiceId);
  if (!draft) return;
  const inv = await prisma.invoice.findUniqueOrThrow({ where: { id: invoiceId }, select: { number: true, alias: true } });
  const data = Buffer.from(await renderInvoicePdf(await pdfDataFromDraft(draft)));
  const doc = { filename: archiveName(inv.number, inv.alias), source: "GENERATED" as const, data, size: data.length, syncError: "" };
  await prisma.invoiceDocument.upsert({ where: { invoiceId }, update: doc, create: { invoiceId, ...doc } });
  await syncDocument(invoiceId);
}

/** After a ledger edit: re-freeze generated PDFs, and keep Drive names and folders in step. */
export async function refreshDocument(invoiceId: string) {
  const doc = await prisma.invoiceDocument.findUnique({ where: { invoiceId }, select: { source: true } });
  if (!doc || doc.source === "GENERATED") return freezeGeneratedPdf(invoiceId);
  return syncDocument(invoiceId);
}

/** Pushes one invoice's PDF to Drive. Failures are recorded, never thrown. */
export async function syncDocument(invoiceId: string): Promise<boolean> {
  try {
    if (!(await driveReady())) return false;
    const doc = await prisma.invoiceDocument.findUnique({
      where: { invoiceId },
      select: { id: true, data: true, contentType: true, driveFileId: true, driveFolderId: true, driveName: true, invoice: { select: { number: true, alias: true, invoiceDate: true } } },
    });
    if (!doc) return false;
    const name = archiveName(doc.invoice.number, doc.invoice.alias);
    const folderId = await monthFolder(doc.invoice.invoiceDate);
    const data = doc.data ? new Uint8Array(doc.data) : undefined;
    const moved = doc.driveFolderId !== folderId || doc.driveName !== name;
    if (doc.driveFileId && !data && !moved) return true;

    const file = doc.driveFileId
      ? await updateFile(doc.driveFileId, { name, fromFolderId: doc.driveFolderId, toFolderId: folderId, data, contentType: doc.contentType })
      : await uploadFile(name, folderId, data!, doc.contentType);

    const verified = !data || file.md5Checksum === createHash("md5").update(data).digest("hex");
    await prisma.invoiceDocument.update({
      where: { id: doc.id },
      data: {
        driveFileId: file.id,
        driveFolderId: folderId,
        driveName: name,
        syncedAt: new Date(),
        syncError: verified ? "" : "Drive's copy didn't match; the local copy is kept.",
        ...(verified ? { data: null } : {}),
      },
    });
    return verified;
  } catch (e) {
    await prisma.invoiceDocument.updateMany({ where: { invoiceId }, data: { syncError: errText(e) } }).catch(() => undefined);
    return false;
  }
}

/** PDF bytes for download: local copy while waiting to upload, otherwise from Drive. */
export async function readDocument(doc: { data: Uint8Array | null; driveFileId: string | null }) {
  if (doc.data) return new Uint8Array(doc.data);
  if (doc.driveFileId) return downloadFile(doc.driveFileId);
  return null;
}

/** Call before deleting an invoice. Trashes its Drive file, or queues that for later. */
export async function discardDocument(invoiceId: string) {
  const doc = await prisma.invoiceDocument.findUnique({ where: { invoiceId }, select: { driveFileId: true } });
  if (!doc?.driveFileId) return;
  try {
    await trashFile(doc.driveFileId);
  } catch {
    await prisma.driveTrash.upsert({ where: { fileId: doc.driveFileId }, update: {}, create: { fileId: doc.driveFileId } });
  }
}

export type SyncSummary = { uploaded: number; failed: number; trashed: number; remaining: number };

/** Uploads PDFs still waiting and retries queued trash. Stops after `budgetMs`. */
export async function syncPendingDocuments(budgetMs = 40_000): Promise<SyncSummary> {
  const started = Date.now();
  const summary: SyncSummary = { uploaded: 0, failed: 0, trashed: 0, remaining: 0 };
  if (!(await driveReady())) {
    summary.remaining = await prisma.invoiceDocument.count({ where: { OR: [{ data: { not: null } }, { driveFileId: null }] } });
    return summary;
  }

  for (const t of await prisma.driveTrash.findMany()) {
    try {
      await trashFile(t.fileId);
      await prisma.driveTrash.delete({ where: { fileId: t.fileId } });
      summary.trashed++;
    } catch {
      break;
    }
  }

  const pending = await prisma.invoiceDocument.findMany({
    where: { OR: [{ data: { not: null } }, { driveFileId: null }] },
    orderBy: { createdAt: "asc" },
    select: { invoiceId: true },
  });
  for (const p of pending) {
    if (Date.now() - started > budgetMs) break;
    if (await syncDocument(p.invoiceId)) summary.uploaded++;
    else summary.failed++;
  }
  summary.remaining = await prisma.invoiceDocument.count({ where: { OR: [{ data: { not: null } }, { driveFileId: null }] } });
  return summary;
}

export async function documentStats() {
  const [total, onDrive, failing, invoices, lastError] = await Promise.all([
    prisma.invoiceDocument.count(),
    prisma.invoiceDocument.count({ where: { driveFileId: { not: null }, data: null } }),
    prisma.invoiceDocument.count({ where: { syncError: { not: "" } } }),
    prisma.invoice.count(),
    prisma.invoiceDocument.findFirst({ where: { syncError: { not: "" } }, orderBy: { updatedAt: "desc" }, select: { syncError: true } }),
  ]);
  return { total, onDrive, waiting: total - onDrive, failing, withoutPdf: invoices - total, lastError: lastError?.syncError ?? null };
}
