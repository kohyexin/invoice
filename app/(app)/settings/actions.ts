"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { authorize } from "@/lib/session";
import { SETTINGS_ENTITIES, type FieldDef, type SettingsEntity } from "@/lib/settings-config";

type Result = { ok: true } | { ok: false; error: string };

function coerce(field: FieldDef, raw: unknown): unknown {
  switch (field.kind) {
    case "checkbox":
      return Boolean(raw);
    case "number": {
      if (raw === "" || raw === null || raw === undefined) return field.required ? NaN : 0;
      return Number(raw);
    }
    case "lines":
      return String(raw ?? "")
        .split("\n")
        .map((l) => l.trimEnd())
        .filter((l) => l.trim() !== "");
    case "select": {
      const v = String(raw ?? "");
      return v === "" && field.nullable ? null : v;
    }
    default: {
      const v = String(raw ?? "").trim();
      return v === "" && field.key === "subtypeHint" ? null : v;
    }
  }
}

function build(entity: SettingsEntity, input: Record<string, unknown>) {
  const data: Record<string, unknown> = {};
  for (const field of SETTINGS_ENTITIES[entity].fields as FieldDef[]) {
    const value = coerce(field, input[field.key]);
    if (field.required && (value === "" || value === null || (typeof value === "number" && Number.isNaN(value)))) {
      throw new Error(`${field.label} is required.`);
    }
    if (typeof value === "number" && Number.isNaN(value)) throw new Error(`${field.label} must be a number.`);
    data[field.key] = value;
  }
  // Optional text fields stored as nullable columns.
  for (const key of ["logoPath", "detailHint", "clientFee"]) {
    if (data[key] === "") data[key] = null;
  }
  return data;
}

function friendly(e: unknown) {
  const msg = e instanceof Error ? e.message : String(e);
  if (msg.includes("Unique constraint")) return "That value is already used by another record.";
  return msg;
}

export async function saveSetting(entity: SettingsEntity, id: string | null, input: Record<string, unknown>): Promise<Result> {
  const auth = await authorize("ADMIN");
  if (!auth.ok) return auth;
  try {
    const data = build(entity, input);
    switch (entity) {
      case "company":
        await (id ? prisma.company.update({ where: { id }, data: data as never }) : prisma.company.create({ data: data as never }));
        break;
      case "bankAccount":
        await (id ? prisma.bankAccount.update({ where: { id }, data: data as never }) : prisma.bankAccount.create({ data: data as never }));
        break;
      case "paymentRule":
        await (id ? prisma.paymentRule.update({ where: { id }, data: data as never }) : prisma.paymentRule.create({ data: data as never }));
        break;
      case "owner":
        await (id ? prisma.owner.update({ where: { id }, data: data as never }) : prisma.owner.create({ data: data as never }));
        break;
      case "invoiceType":
        await (id ? prisma.invoiceType.update({ where: { id }, data: data as never }) : prisma.invoiceType.create({ data: data as never }));
        break;
      case "invoiceItem":
        await (id ? prisma.invoiceItem.update({ where: { id }, data: data as never }) : prisma.invoiceItem.create({ data: data as never }));
        break;
      case "fxRate": {
        const perUsd = Number(data.perUsd);
        if (!(perUsd > 0)) throw new Error("Units per 1 USD must be above zero.");
        const currency = data.currency as never;
        await prisma.fxRate.upsert({
          where: { currency },
          update: { usdPerUnit: 1 / perUsd },
          create: { currency, usdPerUnit: 1 / perUsd },
        });
        break;
      }
    }
    revalidatePath("/settings");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: friendly(e) };
  }
}

export async function deleteSetting(entity: SettingsEntity, id: string): Promise<Result> {
  const auth = await authorize("ADMIN");
  if (!auth.ok) return auth;
  try {
    switch (entity) {
      case "company":
        await prisma.company.delete({ where: { id } });
        break;
      case "bankAccount":
        await prisma.bankAccount.delete({ where: { id } });
        break;
      case "paymentRule":
        await prisma.paymentRule.delete({ where: { id } });
        break;
      case "owner":
        await prisma.owner.delete({ where: { id } });
        break;
      case "invoiceType":
        await prisma.invoiceType.delete({ where: { id } });
        break;
      case "invoiceItem":
        await prisma.invoiceItem.delete({ where: { id } });
        break;
      case "fxRate":
        await prisma.fxRate.delete({ where: { currency: id as never } });
        break;
    }
    revalidatePath("/settings");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: friendly(e) };
  }
}
