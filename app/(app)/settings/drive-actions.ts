"use server";

import { revalidatePath } from "next/cache";
import { syncPendingDocuments, type SyncSummary } from "@/lib/documents";
import { disconnectDrive } from "@/lib/gdrive";
import { authorize } from "@/lib/session";

export async function syncDocumentsNow(): Promise<({ ok: true } & SyncSummary) | { ok: false; error: string }> {
  const auth = await authorize("ADMIN");
  if (!auth.ok) return auth;
  const res = await syncPendingDocuments(45_000);
  revalidatePath("/settings");
  return { ok: true, ...res };
}

export async function disconnectGoogleDrive(): Promise<{ ok: true } | { ok: false; error: string }> {
  const auth = await authorize("ADMIN");
  if (!auth.ok) return auth;
  await disconnectDrive();
  revalidatePath("/settings");
  return { ok: true };
}
