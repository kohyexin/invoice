"use server";

import { revalidatePath } from "next/cache";
import { freshFxRates, refreshFxRates, type FxSnapshot } from "@/lib/fx";
import { can } from "@/lib/roles";
import { authorize } from "@/lib/session";

/** Used from the invoice forms and the FX rates settings. */
export async function refreshRates(): Promise<({ ok: true; failed: string[] } & FxSnapshot) | { ok: false; error: string }> {
  const auth = await authorize();
  if (!auth.ok) return auth;
  const { role } = auth.user;
  if (!can(role, "invoices", "EDIT") && !can(role, "invoiceCreate", "EDIT") && !can(role, "settings", "EDIT"))
    return { ok: false, error: "You do not have permission to do this." };
  const { updated, failed } = await refreshFxRates();
  if (!updated.length) return { ok: false, error: "Couldn't reach Yahoo Finance. The stored rates are still in use." };
  revalidatePath("/settings");
  return { ok: true, failed, ...(await freshFxRates()) };
}
