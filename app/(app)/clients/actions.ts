"use server";

import { revalidatePath } from "next/cache";
import { logActivity } from "@/lib/activity";
import { prisma } from "@/lib/db";
import { joinUrls, normalizeAgreements, splitUrls } from "@/lib/client-import";
import { importClientRows } from "@/lib/client-import-db";
import { authorize } from "@/lib/session";
import { parseDateInput } from "@/lib/utils";

type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };

export async function importJotformRows(
  rows: Record<string, string>[]
): Promise<Result<{ created: number; updated: number; skipped: number }>> {
  const auth = await authorize("clients", "EDIT");
  if (!auth.ok) return auth;
  try {
    const res = await importClientRows(prisma, rows);
    await logActivity(auth.user, { action: "import", entity: "client", label: "Jotform import", changes: res });
    revalidatePath("/clients");
    return { ok: true, ...res };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export type ClientInput = {
  name: string;
  alias: string;
  agreementNo: string;
  /** Comma- or space-separated. */
  otherAgreements: string;
  agreementDate: string;
  country: string;
  incorporationNo: string;
  address1: string;
  address2: string;
  address3: string;
  city: string;
  directorName: string;
  contactTitle: string;
  contactEmail: string;
  websiteUrls: string;
  transferName: string;
  defaultOwnerId: string;
  notes: string;
  fees: Record<string, string>;
};

export async function saveClient(id: string | null, input: ClientInput): Promise<Result<{ id: string }>> {
  const auth = await authorize("clients", "EDIT");
  if (!auth.ok) return auth;
  const name = input.name.trim();
  if (!name) return { ok: false, error: "Client name is required." };
  const fees = Object.fromEntries(
    Object.entries(input.fees)
      .map(([k, v]) => [k.trim().toUpperCase(), v.trim()])
      .filter(([k, v]) => k && v)
  );
  const data = {
    name,
    alias: input.alias.trim().toUpperCase(),
    agreementNo: input.agreementNo.trim(),
    otherAgreements: normalizeAgreements(input.otherAgreements.split(/[\s,;]+/)).filter(
      (a) => a !== input.agreementNo.trim().toUpperCase()
    ),
    agreementDate: parseDateInput(input.agreementDate),
    country: input.country.trim(),
    incorporationNo: input.incorporationNo.trim(),
    address1: input.address1.trim(),
    address2: input.address2.trim(),
    address3: input.address3.trim(),
    city: input.city.trim(),
    directorName: input.directorName.trim(),
    contactTitle: input.contactTitle.trim(),
    contactEmail: input.contactEmail.trim(),
    websiteUrls: joinUrls(splitUrls(input.websiteUrls)),
    transferName: input.transferName.trim(),
    defaultOwnerId: input.defaultOwnerId || null,
    notes: input.notes,
    fees,
  };
  try {
    const before = id ? await prisma.client.findUnique({ where: { id } }) : null;
    const row = id
      ? await prisma.client.update({ where: { id }, data })
      : await prisma.client.create({ data });
    await logActivity(auth.user, { action: id ? "update" : "create", entity: "client", entityId: row.id, label: row.name, before, after: data });
    revalidatePath("/clients");
    revalidatePath(`/clients/${row.id}`);
    return { ok: true, id: row.id };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: msg.includes("Unique constraint") ? "Another client already has that name." : msg };
  }
}

export async function deleteClient(id: string): Promise<Result> {
  const auth = await authorize("clients", "EDIT");
  if (!auth.ok) return auth;
  const count = await prisma.invoice.count({ where: { clientId: id } });
  if (count > 0) return { ok: false, error: `This client has ${count} invoice(s). Delete or move them first.` };
  const agreements = await prisma.agreement.count({ where: { clientId: id } });
  if (agreements > 0) return { ok: false, error: `This client has ${agreements} agreement(s). Delete them first.` };
  const before = await prisma.client.delete({ where: { id } });
  await logActivity(auth.user, { action: "delete", entity: "client", entityId: id, label: before.name, before });
  revalidatePath("/clients");
  return { ok: true };
}
