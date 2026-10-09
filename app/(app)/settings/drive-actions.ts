"use server";

import { revalidatePath } from "next/cache";
import { logActivity } from "@/lib/activity";
import { syncPendingAgreementDocuments } from "@/lib/agreement-documents";
import { syncPendingDocuments, type SyncSummary } from "@/lib/documents";
import { disconnectDrive } from "@/lib/gdrive";
import { authorize } from "@/lib/session";

export async function syncDocumentsNow(): Promise<({ ok: true } & SyncSummary) | { ok: false; error: string }> {
  const auth = await authorize("settings", "EDIT");
  if (!auth.ok) return auth;
  const res = await syncPendingDocuments(35_000);
  const agreements = await syncPendingAgreementDocuments(10_000);
  revalidatePath("/settings");
  return {
    ok: true,
    ...res,
    uploaded: res.uploaded + agreements.uploaded,
    failed: res.failed + agreements.failed,
    remaining: res.remaining + agreements.remaining,
  };
}

export async function disconnectGoogleDrive(): Promise<{ ok: true } | { ok: false; error: string }> {
  const auth = await authorize("settings", "EDIT");
  if (!auth.ok) return auth;
  await disconnectDrive();
  await logActivity(auth.user, { action: "disconnect", entity: "setting:googleDrive", label: "Google Drive" });
  revalidatePath("/settings");
  return { ok: true };
}
