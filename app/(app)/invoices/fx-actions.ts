"use server";

import { revalidatePath } from "next/cache";
import { freshFxRates, refreshFxRates, type FxSnapshot } from "@/lib/fx";
import { authorize } from "@/lib/session";

export async function refreshRates(): Promise<({ ok: true; failed: string[] } & FxSnapshot) | { ok: false; error: string }> {
  const auth = await authorize("STAFF");
  if (!auth.ok) return auth;
  const { updated, failed } = await refreshFxRates();
  if (!updated.length) return { ok: false, error: "Couldn't reach Yahoo Finance. The stored rates are still in use." };
  revalidatePath("/settings");
  return { ok: true, failed, ...(await freshFxRates()) };
}
