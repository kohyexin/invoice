"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { clientData, toClientDraft } from "@/lib/client-import";
import { parseDateInput } from "@/lib/utils";

type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };

export async function importJotformRows(
  rows: Record<string, string>[]
): Promise<Result<{ created: number; updated: number; skipped: number }>> {
  let created = 0;
  let updated = 0;
  let skipped = 0;
  try {
    for (const row of rows) {
      const draft = toClientDraft(row);
      if (!draft) {
        skipped++;
        continue;
      }
      const existing = await prisma.client.findUnique({ where: { name: draft.name }, select: { id: true } });
      const jotformTaken =
        draft.jotformId &&
        (await prisma.client.findFirst({
          where: { jotformId: draft.jotformId, NOT: { name: draft.name } },
          select: { id: true },
        }));
      const jotformId = jotformTaken ? undefined : draft.jotformId ?? undefined;

      if (existing) {
        await prisma.client.update({ where: { id: existing.id }, data: { ...clientData(draft), jotformId } });
        updated++;
      } else {
        await prisma.client.create({ data: { name: draft.name, ...clientData(draft), jotformId } });
        created++;
      }
    }
    revalidatePath("/clients");
    return { ok: true, created, updated, skipped };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export type ClientInput = {
  name: string;
  alias: string;
  agreementNo: string;
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
    websiteUrls: input.websiteUrls.trim(),
    transferName: input.transferName.trim(),
    defaultOwnerId: input.defaultOwnerId || null,
    notes: input.notes,
    fees,
  };
  try {
    const row = id
      ? await prisma.client.update({ where: { id }, data })
      : await prisma.client.create({ data });
    revalidatePath("/clients");
    revalidatePath(`/clients/${row.id}`);
    return { ok: true, id: row.id };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: msg.includes("Unique constraint") ? "Another client already has that name." : msg };
  }
}

export async function deleteClient(id: string): Promise<Result> {
  const count = await prisma.invoice.count({ where: { clientId: id } });
  if (count > 0) return { ok: false, error: `This client has ${count} invoice(s). Delete or move them first.` };
  await prisma.client.delete({ where: { id } });
  revalidatePath("/clients");
  return { ok: true };
}
