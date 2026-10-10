"use server";

import { revalidatePath } from "next/cache";
import { logActivity } from "@/lib/activity";
import { agreementFilename, discardAgreementDocuments, syncAgreementDocument } from "@/lib/agreement-documents";
import { ADDRESS_LINES, CLIENT_KEYS, FEE_PREFIX, isInput, parseFieldConfig, splitAddress, type FieldBox, type FieldConfig } from "@/lib/agreements/fields";
import { applyLayout, discoverFields, fillPdf } from "@/lib/agreements/pdf";
import { joinUrls, nameKey, normalizeAgreements, splitUrls } from "@/lib/client-import";
import { prisma } from "@/lib/db";
import { authorize } from "@/lib/session";
import { parseDateInput } from "@/lib/utils";

type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));
const cleanCode = (code: string) => code.trim().toUpperCase().replace(/[^A-Z0-9-]+/g, "");

async function readPdf(form: FormData) {
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) throw new Error("Choose a PDF file.");
  if (file.type && file.type !== "application/pdf") throw new Error("The template must be a PDF.");
  return { bytes: new Uint8Array(await file.arrayBuffer()), filename: file.name };
}

/* ----------------------------- Templates ----------------------------- */

export async function uploadTemplate(form: FormData): Promise<Result<{ id: string }>> {
  const auth = await authorize("agreements", "EDIT");
  if (!auth.ok) return auth;
  const name = String(form.get("name") ?? "").trim();
  const code = cleanCode(String(form.get("code") ?? ""));
  if (!name || !code) return { ok: false, error: "Name and code are required." };
  try {
    const { bytes, filename } = await readPdf(form);
    const fields = await discoverFields(bytes);
    const last = await prisma.agreementTemplate.aggregate({ _max: { sortOrder: true } });
    const row = await prisma.agreementTemplate.create({
      data: { name, code, pdf: Buffer.from(bytes), pdfFilename: filename, fieldConfig: fields, sortOrder: (last._max.sortOrder ?? 0) + 1 },
    });
    await logActivity(auth.user, {
      action: "create",
      entity: "agreement_template",
      entityId: row.id,
      label: name,
      after: { name, code, pdfFilename: filename, fields: fields.length },
    });
    revalidatePath("/agreements/templates");
    return { ok: true, id: row.id };
  } catch (e) {
    const msg = errText(e);
    return { ok: false, error: msg.includes("Unique constraint") ? "Another template already has that name or code." : msg };
  }
}

/** A new version of the blank PDF. Fields keep their setup when the name is unchanged. */
export async function replaceTemplatePdf(id: string, form: FormData): Promise<Result<{ added: number; removed: number }>> {
  const auth = await authorize("agreements", "EDIT");
  if (!auth.ok) return auth;
  try {
    const { bytes, filename } = await readPdf(form);
    const discovered = await discoverFields(bytes);
    const before = await prisma.agreementTemplate.findUniqueOrThrow({ where: { id }, select: { name: true, fieldConfig: true, pdfFilename: true } });
    const old = new Map(parseFieldConfig(before.fieldConfig).map((f) => [f.pdfFieldName, f]));
    const fields = discovered.map((f) => old.get(f.pdfFieldName) ?? f);
    const added = discovered.filter((f) => !old.has(f.pdfFieldName)).length;
    const removed = old.size - (discovered.length - added);
    await prisma.agreementTemplate.update({ where: { id }, data: { pdf: Buffer.from(bytes), pdfFilename: filename, fieldConfig: fields } });
    await logActivity(auth.user, {
      action: "upload",
      entity: "agreement_template",
      entityId: id,
      label: before.name,
      changes: { pdfFilename: [before.pdfFilename, filename], added, removed },
    });
    revalidatePath(`/agreements/templates/${id}`);
    return { ok: true, added, removed };
  } catch (e) {
    return { ok: false, error: errText(e) };
  }
}

export type TemplateInput = { name: string; code: string; active: boolean; fields: FieldConfig[] };

function parseBoxes(raw: unknown): FieldBox[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((b) => ({
      pdfFieldName: String(b?.pdfFieldName ?? ""),
      page: Math.trunc(Number(b?.page)),
      x: Number(b?.x),
      y: Number(b?.y),
      width: Number(b?.width),
      height: Number(b?.height),
    }))
    .filter((b) => b.pdfFieldName && !b.pdfFieldName.includes(".") && [b.page, b.x, b.y, b.width, b.height].every(Number.isFinite) && b.page >= 0 && b.width > 0 && b.height > 0);
}

/** Saves the field setup. With `boxes` (from the field editor), also writes the
 *  placed fields into the template PDF. */
export async function saveTemplate(id: string, input: TemplateInput, boxes?: FieldBox[]): Promise<Result> {
  const auth = await authorize("agreements", "EDIT");
  if (!auth.ok) return auth;
  const name = input.name.trim();
  const code = cleanCode(input.code);
  if (!name || !code) return { ok: false, error: "Name and code are required." };
  const before = await prisma.agreementTemplate.findUnique({ where: { id }, select: { name: true, code: true, active: true, fieldConfig: true, pdf: true } });
  if (!before) return { ok: false, error: "Template not found." };
  const configured = parseFieldConfig(input.fields).map((f) => ({
    ...f,
    label: f.label.trim() || f.pdfFieldName,
    clientKey: f.type === "signature" ? "" : f.clientKey,
  }));
  const names = configured.map((f) => f.pdfFieldName);
  if (names.some((n, i) => names.indexOf(n) !== i)) return { ok: false, error: "Two fields have the same name." };
  const keys = configured.map((f) => f.clientKey).filter((k) => k && !k.startsWith(FEE_PREFIX));
  const dup = keys.find((k, i) => keys.indexOf(k) !== i);
  if (dup) return { ok: false, error: `Only one field can fill the client's ${CLIENT_KEYS.find((c) => c.key === dup)?.label ?? dup}.` };
  if (keys.includes("address") && keys.some((k) => (ADDRESS_LINES as readonly string[]).includes(k))) {
    return { ok: false, error: "Use either the combined address or the separate address lines, not both." };
  }
  const unassigned = configured.filter((f) => f.type === "signature" && !f.signerRole);
  if (unassigned.length) return { ok: false, error: `Pick who signs: ${unassigned.map((f) => f.label).join(", ")}.` };
  try {
    const pdf = boxes ? await applyLayout(new Uint8Array(before.pdf), configured, parseBoxes(boxes)) : null;
    const known = new Set((pdf ? await discoverFields(pdf) : parseFieldConfig(before.fieldConfig)).map((f) => f.pdfFieldName));
    const fields = configured.filter((f) => known.has(f.pdfFieldName));
    const data = { name, code, active: input.active, fieldConfig: fields };
    await prisma.agreementTemplate.update({ where: { id }, data: pdf ? { ...data, pdf: Buffer.from(pdf) } : data });
    await logActivity(auth.user, { action: "update", entity: "agreement_template", entityId: id, label: name, before, after: data });
    revalidatePath("/agreements/templates");
    revalidatePath(`/agreements/templates/${id}`);
    return { ok: true };
  } catch (e) {
    const msg = errText(e);
    return { ok: false, error: msg.includes("Unique constraint") ? "Another template already has that name or code." : msg };
  }
}

export async function deleteTemplate(id: string): Promise<Result> {
  const auth = await authorize("agreements", "EDIT");
  if (!auth.ok) return auth;
  const count = await prisma.agreement.count({ where: { templateId: id } });
  if (count > 0) return { ok: false, error: `${count} agreement(s) use this template. Turn it off instead.` };
  const before = await prisma.agreementTemplate.delete({ where: { id }, select: { name: true, code: true, pdfFilename: true } });
  await logActivity(auth.user, { action: "delete", entity: "agreement_template", entityId: id, label: before.name, before });
  revalidatePath("/agreements/templates");
  return { ok: true };
}

/* ----------------------------- Agreements ---------------------------- */

export type AgreementInput = {
  templateId: string;
  /** An existing client, or null to create one named `newClientName`. */
  clientId: string | null;
  newClientName: string;
  values: Record<string, string>;
};

/** The client details and fees the entered values map to (blank values left out). */
function mappedDetails(fields: FieldConfig[], values: Record<string, string>) {
  const details: Record<string, string> = {};
  const fees: Record<string, string> = {};
  for (const f of fields) {
    const v = values[f.pdfFieldName];
    if (!f.clientKey || !v || f.type === "checkbox") continue;
    if (f.clientKey.startsWith(FEE_PREFIX)) fees[f.clientKey.slice(FEE_PREFIX.length)] = v;
    else if (f.clientKey === "address") splitAddress(v).forEach((line, i) => (details[ADDRESS_LINES[i]] = line));
    else if (f.clientKey === "websiteUrls") details.websiteUrls = joinUrls(splitUrls(v));
    else details[f.clientKey] = v;
  }
  return { details, fees };
}

/** Client text columns the form can set. A combined address sets all three lines, blank ones included. */
const DETAIL_TEXT = CLIENT_KEYS.map((c) => c.key).filter((k) => k !== "name" && k !== "agreementNo" && k !== "agreementDate" && k !== "address");

export async function createAgreement(input: AgreementInput): Promise<Result<{ id: string }>> {
  const auth = await authorize("agreements", "EDIT");
  if (!auth.ok) return auth;
  const template = await prisma.agreementTemplate.findUnique({ where: { id: input.templateId } });
  if (!template?.active) return { ok: false, error: "Pick an agreement template." };
  const fields = parseFieldConfig(template.fieldConfig).filter(isInput);
  const values = Object.fromEntries(fields.map((f) => [f.pdfFieldName, String(input.values[f.pdfFieldName] ?? "").trim()]));
  const missing = fields.filter((f) => f.required && (!values[f.pdfFieldName] || (f.type === "checkbox" && values[f.pdfFieldName] !== "true")));
  if (missing.length) return { ok: false, error: `Fill in: ${missing.map((f) => f.label).join(", ")}.` };

  const { details, fees } = mappedDetails(fields, values);
  const agreementNo = details.agreementNo ?? "";
  const agreementDate = details.agreementDate ? parseDateInput(details.agreementDate) : null;
  const text = Object.fromEntries(DETAIL_TEXT.filter((k) => details[k] !== undefined).map((k) => [k, details[k]]));

  try {
    const existing = input.clientId ? await prisma.client.findUnique({ where: { id: input.clientId } }) : null;
    if (input.clientId && !existing) return { ok: false, error: "That client no longer exists." };
    const newName = (input.newClientName.trim() || details.name || "").replace(/\s+/g, " ");
    if (!existing) {
      if (!newName) return { ok: false, error: "Enter the new client's name." };
      const clash = await prisma.client.findFirst({ where: { name: { equals: newName, mode: "insensitive" } }, select: { name: true } });
      if (clash && nameKey(clash.name) === nameKey(newName)) return { ok: false, error: `${clash.name} is already a client. Pick it from the list instead.` };
    }
    const clientName = existing?.name ?? newName;
    const agreementRef = agreementNo.toUpperCase();
    const filename = agreementFilename({ agreementRef, template, client: { name: clientName } });
    const pdf = Buffer.from(await fillPdf(new Uint8Array(template.pdf), fields, values));

    /* An existing client takes the entered details (the form started from its
     * own), keeps its name, and gains the fees. A second agreement number goes
     * to its other agreements, as with the Jotform import. */
    let clientUpdate: Record<string, unknown> | null = null;
    if (existing) {
      clientUpdate = { ...text, fees: { ...((existing.fees as Record<string, string>) ?? {}), ...fees } };
      const primary = !existing.agreementNo.trim() || nameKey(existing.agreementNo) === nameKey(agreementNo);
      if (agreementNo && !primary) {
        clientUpdate.otherAgreements = normalizeAgreements([...existing.otherAgreements, agreementNo]);
      } else {
        if (agreementNo) clientUpdate.agreementNo = agreementNo;
        if (agreementDate) clientUpdate.agreementDate = agreementDate;
      }
    }

    const agreement = await prisma.$transaction(async (tx) => {
      const client = existing
        ? await tx.client.update({ where: { id: existing.id }, data: clientUpdate! })
        : await tx.client.create({ data: { name: clientName, ...text, agreementNo, agreementDate, fees } });
      return tx.agreement.create({
        data: {
          templateId: template.id,
          clientId: client.id,
          status: "FINALIZED",
          values,
          agreementRef,
          finalizedAt: new Date(),
          createdById: auth.user.id,
          documents: { create: { variant: "FILLED", filename, data: pdf, size: pdf.length } },
        },
        select: { id: true, clientId: true },
      });
    });

    if (existing) {
      await logActivity(auth.user, { action: "update", entity: "client", entityId: existing.id, label: existing.name, before: existing, after: clientUpdate });
    } else {
      await logActivity(auth.user, { action: "create", entity: "client", entityId: agreement.clientId, label: clientName, after: { name: clientName, ...text, agreementNo, agreementDate, fees } });
    }
    await logActivity(auth.user, {
      action: "create",
      entity: "agreement",
      entityId: agreement.id,
      label: [template.code, agreementRef, clientName].filter(Boolean).join(" · "),
      after: { template: template.name, client: clientName, agreementRef },
    });
    await syncAgreementDocument(agreement.id);

    revalidatePath("/agreements");
    revalidatePath("/clients");
    revalidatePath(`/clients/${agreement.clientId}`);
    return { ok: true, id: agreement.id };
  } catch (e) {
    return { ok: false, error: errText(e) };
  }
}

/** What deleting an agreement does to its client, shown before confirming. */
export type AgreementDeletePlan = {
  client: { id: string; name: string };
  /** The agreement number leaves the client: its main one or one of its other agreements. */
  number: { ref: string; where: "main" | "other"; remove: boolean; invoices: number } | null;
  /** Saving this agreement created the client. */
  createdClient: boolean;
  /** Other records on the client; it can only be deleted when all are 0. */
  links: { invoices: number; agreements: number; credits: number; importReviews: number };
};

/** A client saved together with its agreement was created in the same moment. */
const CREATED_TOGETHER_MS = 60_000;

async function deletePlan(id: string): Promise<AgreementDeletePlan | null> {
  const a = await prisma.agreement.findUnique({
    where: { id },
    select: {
      agreementRef: true,
      createdAt: true,
      client: { select: { id: true, name: true, agreementNo: true, otherAgreements: true, createdAt: true } },
    },
  });
  if (!a) return null;
  const c = a.client;
  const [invoices, agreements, credits, importReviews, sameRef, refInvoices] = await Promise.all([
    prisma.invoice.count({ where: { clientId: c.id } }),
    prisma.agreement.count({ where: { clientId: c.id, id: { not: id } } }),
    prisma.clientCredit.count({ where: { clientId: c.id } }),
    prisma.importReview.count({ where: { clientId: c.id } }),
    a.agreementRef ? prisma.agreement.count({ where: { clientId: c.id, id: { not: id }, agreementRef: a.agreementRef } }) : 0,
    a.agreementRef ? prisma.invoice.count({ where: { clientId: c.id, reference: { equals: a.agreementRef, mode: "insensitive" } } }) : 0,
  ]);

  let number: AgreementDeletePlan["number"] = null;
  const ref = a.agreementRef;
  const main = ref && nameKey(c.agreementNo) === nameKey(ref);
  const other = ref && c.otherAgreements.some((o) => nameKey(o) === nameKey(ref));
  if (main || other) {
    /* Invoice numbers follow the main agreement number, so it stays while the client has any invoices. */
    const inUse = main ? invoices : refInvoices;
    number = { ref, where: main ? "main" : "other", remove: sameRef === 0 && inUse === 0, invoices: inUse };
  }
  return {
    client: { id: c.id, name: c.name },
    number,
    createdClient: Math.abs(c.createdAt.getTime() - a.createdAt.getTime()) < CREATED_TOGETHER_MS,
    links: { invoices, agreements, credits, importReviews },
  };
}

export async function agreementDeletePlan(id: string): Promise<Result<{ plan: AgreementDeletePlan }>> {
  const auth = await authorize("agreements", "EDIT");
  if (!auth.ok) return auth;
  const plan = await deletePlan(id);
  return plan ? { ok: true, plan } : { ok: false, error: "Agreement not found." };
}

/** Deletes the agreement, takes its number off the client when nothing uses it,
 *  and with `deleteClient` also deletes the client it created if nothing else is linked. */
export async function deleteAgreement(id: string, opts: { deleteClient?: boolean } = {}): Promise<Result<{ clientDeleted: boolean }>> {
  const auth = await authorize("agreements", "EDIT");
  if (!auth.ok) return auth;
  const before = await prisma.agreement.findUnique({
    where: { id },
    select: { agreementRef: true, status: true, clientId: true, template: { select: { code: true } }, client: { select: { name: true } } },
  });
  const plan = await deletePlan(id);
  if (!before || !plan) return { ok: false, error: "Agreement not found." };
  const linked = Object.values(plan.links).some((n) => n > 0);
  const dropClient = Boolean(opts.deleteClient) && plan.createdClient && !linked;
  if (opts.deleteClient && !dropClient) return { ok: false, error: "The client has other records now, so it can't be deleted with the agreement." };
  if (dropClient && !(await authorize("clients", "EDIT")).ok) return { ok: false, error: "You can't delete clients." };

  await discardAgreementDocuments(id);
  const client = await prisma.$transaction(async (tx) => {
    await tx.agreement.delete({ where: { id } });
    if (dropClient) return tx.client.delete({ where: { id: plan.client.id } });
    if (plan.number?.remove) {
      const c = await tx.client.findUniqueOrThrow({ where: { id: plan.client.id }, select: { otherAgreements: true } });
      const key = nameKey(plan.number.ref);
      await tx.client.update({
        where: { id: plan.client.id },
        data:
          plan.number.where === "main"
            ? { agreementNo: "", agreementDate: null }
            : { otherAgreements: c.otherAgreements.filter((o) => nameKey(o) !== key) },
      });
    }
    return null;
  });

  await logActivity(auth.user, {
    action: "delete",
    entity: "agreement",
    entityId: id,
    label: [before.template.code, before.agreementRef, before.client.name].filter(Boolean).join(" · "),
    before: { template: before.template.code, client: before.client.name, agreementRef: before.agreementRef, status: before.status },
  });
  if (client) {
    await logActivity(auth.user, { action: "delete", entity: "client", entityId: client.id, label: client.name, before: client });
  } else if (plan.number?.remove) {
    await logActivity(auth.user, {
      action: "update",
      entity: "client",
      entityId: plan.client.id,
      label: plan.client.name,
      changes: { removedAgreement: plan.number.ref },
    });
  }
  revalidatePath("/agreements");
  revalidatePath("/clients");
  revalidatePath(`/clients/${before.clientId}`);
  return { ok: true, clientDeleted: Boolean(client) };
}
