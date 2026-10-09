import "server-only";
import { createHash } from "node:crypto";
import type { AgreementDocumentVariant } from "@/lib/generated/prisma/client";
import { prisma } from "@/lib/db";
import { agreementYearFolder, driveConfigured, getDriveConnection, trashFile, updateFile, uploadFile } from "@/lib/gdrive";
import { archiveName } from "@/lib/documents";

/* Agreement PDFs, archived on Google Drive apart from invoices: unsigned copies
 * under "STAR SAAS Agreements", signed ones (phase 2) under "STAR SAAS Signed
 * agreements", each filed as <year>/<agreement no.> <client>.pdf.
 * As with invoices, the local copy is dropped only after Drive confirms it. */

const errText = (e: unknown) => (e instanceof Error ? e.message : "Upload failed.");
const PENDING = { OR: [{ data: { not: null } }, { driveFileId: null }] };

async function driveReady() {
  return driveConfigured() && Boolean(await getDriveConnection());
}

export function agreementFilename(a: { agreementRef: string; template: { code: string }; client: { name: string } }) {
  return archiveName(a.agreementRef || a.template.code, a.client.name);
}

/** Pushes one agreement PDF to Drive. Failures are recorded, never thrown. */
export async function syncAgreementDocument(agreementId: string, variant: AgreementDocumentVariant = "FILLED"): Promise<boolean> {
  try {
    if (!(await driveReady())) return false;
    const doc = await prisma.agreementDocument.findUnique({
      where: { agreementId_variant: { agreementId, variant } },
      select: {
        id: true,
        data: true,
        contentType: true,
        driveFileId: true,
        driveFolderId: true,
        driveName: true,
        agreement: { select: { agreementRef: true, finalizedAt: true, createdAt: true, template: { select: { code: true } }, client: { select: { name: true } } } },
      },
    });
    if (!doc) return false;
    const name = agreementFilename(doc.agreement);
    const folderId = await agreementYearFolder(doc.agreement.finalizedAt ?? doc.agreement.createdAt, variant === "SIGNED");
    const data = doc.data ? new Uint8Array(doc.data) : undefined;
    const moved = doc.driveFolderId !== folderId || doc.driveName !== name;
    if (doc.driveFileId && !data && !moved) return true;

    const file = doc.driveFileId
      ? await updateFile(doc.driveFileId, { name, fromFolderId: doc.driveFolderId, toFolderId: folderId, data, contentType: doc.contentType })
      : await uploadFile(name, folderId, data!, doc.contentType);

    const verified = !data || file.md5Checksum === createHash("md5").update(data).digest("hex");
    await prisma.agreementDocument.update({
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
    await prisma.agreementDocument.updateMany({ where: { agreementId, variant }, data: { syncError: errText(e) } }).catch(() => undefined);
    return false;
  }
}

/** Phase 2: the fully signed copy, filed under "STAR SAAS Signed agreements". */
export async function archiveSignedAgreement(agreementId: string, pdf: Uint8Array) {
  const a = await prisma.agreement.findUniqueOrThrow({
    where: { id: agreementId },
    select: { agreementRef: true, template: { select: { code: true } }, client: { select: { name: true } } },
  });
  const data = Buffer.from(pdf);
  const doc = { filename: agreementFilename(a), data, size: data.length, syncError: "" };
  await prisma.agreementDocument.upsert({
    where: { agreementId_variant: { agreementId, variant: "SIGNED" } },
    update: doc,
    create: { agreementId, variant: "SIGNED", ...doc },
  });
  await syncAgreementDocument(agreementId, "SIGNED");
}

/** Call before deleting an agreement. Trashes its Drive files, or queues that for later. */
export async function discardAgreementDocuments(agreementId: string) {
  const docs = await prisma.agreementDocument.findMany({ where: { agreementId, driveFileId: { not: null } }, select: { driveFileId: true } });
  for (const d of docs) {
    try {
      await trashFile(d.driveFileId!);
    } catch {
      await prisma.driveTrash.upsert({ where: { fileId: d.driveFileId! }, update: {}, create: { fileId: d.driveFileId! } });
    }
  }
}

/** Uploads agreement PDFs still waiting. Stops after `budgetMs`. */
export async function syncPendingAgreementDocuments(budgetMs = 20_000) {
  const started = Date.now();
  const summary = { uploaded: 0, failed: 0, remaining: 0 };
  if (await driveReady()) {
    const pending = await prisma.agreementDocument.findMany({ where: PENDING, orderBy: { createdAt: "asc" }, select: { agreementId: true, variant: true } });
    for (const p of pending) {
      if (Date.now() - started > budgetMs) break;
      if (await syncAgreementDocument(p.agreementId, p.variant)) summary.uploaded++;
      else summary.failed++;
    }
  }
  summary.remaining = await prisma.agreementDocument.count({ where: PENDING });
  return summary;
}

export async function agreementDocumentStats() {
  const [total, onDrive, failing, lastError] = await Promise.all([
    prisma.agreementDocument.count(),
    prisma.agreementDocument.count({ where: { driveFileId: { not: null }, data: null } }),
    prisma.agreementDocument.count({ where: { syncError: { not: "" } } }),
    prisma.agreementDocument.findFirst({ where: { syncError: { not: "" } }, orderBy: { updatedAt: "desc" }, select: { syncError: true } }),
  ]);
  return { total, onDrive, waiting: total - onDrive, failing, lastError: lastError?.syncError ?? null };
}
