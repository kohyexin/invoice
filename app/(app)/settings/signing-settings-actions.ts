"use server";

import { revalidatePath } from "next/cache";
import { logActivity } from "@/lib/activity";
import { getSigningSettings, saveSigningSettings, validateSigningSettings, type SigningSettings } from "@/lib/agreements/signing-settings";
import { authorize } from "@/lib/session";

export async function updateSigningSettings(input: SigningSettings): Promise<{ ok: true } | { ok: false; error: string }> {
  const auth = await authorize("settings", "EDIT");
  if (!auth.ok) return auth;
  const checked = validateSigningSettings(input);
  if (!checked.ok) return checked;
  const before = await getSigningSettings();
  await saveSigningSettings(checked.value);
  await logActivity(auth.user, { action: "update", entity: "setting:agreementSigning", label: "Agreement signing", before, after: checked.value });
  revalidatePath("/settings");
  return { ok: true };
}
