import "server-only";
import { createHash } from "node:crypto";
import { prisma } from "@/lib/db";
import type { Currency } from "@/lib/generated/prisma/client";
import { CURRENCIES, parseDateInput } from "@/lib/utils";
import { fxRates, toUsd } from "@/lib/rules";
import { extractPdfText, parseSystemInvoiceText, type SystemInvoice } from "@/lib/system-invoice";

export type ImportSource = {
  data: Uint8Array;
  filename: string;
  /** Stable id for dedupe: email Message-ID + filename, or upload hash. */
  messageId?: string;
  subject?: string;
  receivedAt?: Date | null;
};

export type ImportOutcome =
  | { status: "imported"; invoiceId: string; number: string; client: string }
  | { status: "duplicate"; number: string }
  | { status: "review"; reviewId: string; reason: string }
  | { status: "skipped"; reason: string };

const norm = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, "");

async function matchClient(inv: Partial<SystemInvoice>) {
  if (inv.reference) {
    const byRef = await prisma.client.findMany({ where: { agreementNo: { equals: inv.reference, mode: "insensitive" } }, select: { id: true } });
    if (byRef.length === 1) return { id: byRef[0].id };
    if (byRef.length > 1) return { reason: `Reference ${inv.reference} matches ${byRef.length} clients.` };
  }
  if (inv.clientName) {
    const key = norm(inv.clientName);
    const all = await prisma.client.findMany({ select: { id: true, alias: true, name: true } });
    const hits = all.filter((c) => (c.alias && norm(c.alias) === key) || norm(c.name) === key);
    if (hits.length === 1) return { id: hits[0].id };
    if (hits.length > 1) return { reason: `Client name ${inv.clientName} matches ${hits.length} clients.` };
  }
  return { reason: `No client with reference ${inv.reference || "—"} or alias ${inv.clientName || "—"}.` };
}

async function toReview(src: ImportSource, messageId: string, reason: string, parsed: Partial<SystemInvoice> | null): Promise<ImportOutcome> {
  const row = await prisma.importReview.upsert({
    where: { messageId },
    update: { reason, parsed: parsed ?? undefined, status: "PENDING" },
    create: {
      messageId,
      subject: src.subject ?? "",
      receivedAt: src.receivedAt ?? null,
      filename: src.filename,
      pdf: Buffer.from(src.data),
      parsed: parsed ?? undefined,
      reason,
    },
  });
  return { status: "review", reviewId: row.id, reason };
}

/** Posts one system-invoice PDF to the ledger, or parks it for review. */
export async function importSystemPdf(src: ImportSource, forceClientId?: string, actorId?: string): Promise<ImportOutcome> {
  const messageId = src.messageId ?? `upload:${createHash("sha256").update(src.data).digest("hex").slice(0, 32)}`;

  if (!forceClientId) {
    const [done, parked] = await Promise.all([
      prisma.invoice.findUnique({ where: { sourceMessageId: messageId }, select: { number: true } }),
      prisma.importReview.findUnique({ where: { messageId }, select: { status: true } }),
    ]);
    if (done) return { status: "duplicate", number: done.number };
    if (parked && parked.status !== "PENDING") return { status: "skipped", reason: `Already ${parked.status.toLowerCase()}.` };
  }

  let text: string;
  try {
    text = await extractPdfText(src.data);
  } catch {
    return toReview(src, messageId, "The attachment could not be read as a PDF.", null);
  }
  const parsed = parseSystemInvoiceText(text);
  if (!parsed.ok) return toReview(src, messageId, parsed.error, parsed.partial);
  const inv = parsed.invoice;

  const existing = await prisma.invoice.findFirst({ where: { number: inv.number }, select: { id: true, document: { select: { id: true } } } });
  if (existing) {
    if (!existing.document) {
      await prisma.invoiceDocument.create({ data: { invoiceId: existing.id, filename: src.filename, data: Buffer.from(src.data) } });
    }
    await prisma.importReview.updateMany({ where: { messageId, status: "PENDING" }, data: { status: "DISMISSED", reason: "Already in the ledger." } });
    return { status: "duplicate", number: inv.number };
  }

  const match = forceClientId ? { id: forceClientId } : await matchClient(inv);
  if (!("id" in match) || !match.id) return toReview(src, messageId, match.reason ?? "No client match.", inv);

  const [client, last] = await Promise.all([
    prisma.client.findUniqueOrThrow({ where: { id: match.id }, select: { id: true, name: true, alias: true, defaultOwnerId: true } }),
    prisma.invoice.findFirst({
      where: { clientId: match.id, generate: "SYSTEM" },
      orderBy: { invoiceDate: "desc" },
      select: { typeId: true, subtype: true, ownerId: true },
    }),
  ]);

  const currency: Currency = (CURRENCIES as readonly string[]).includes(inv.currency) ? (inv.currency as Currency) : "USD";
  const usdAmount = toUsd(inv.amount, currency, await fxRates());
  if (usdAmount === null) return toReview(src, messageId, `No FX rate for ${currency}.`, inv);

  const created = await prisma.invoice.create({
    data: {
      number: inv.number,
      clientId: client.id,
      alias: client.alias || inv.clientName.toUpperCase(),
      ownerId: last?.ownerId ?? client.defaultOwnerId,
      typeId: last?.typeId ?? null,
      subtype: last?.subtype ?? "",
      generate: "SYSTEM",
      status: "SENT",
      invoiceDate: parseDateInput(inv.invoiceDate)!,
      dueDate: parseDateInput(inv.dueDate),
      billingFrom: parseDateInput(inv.periodFrom),
      billingTo: parseDateInput(inv.periodTo),
      reference: inv.reference,
      currency,
      amount: inv.amount,
      usdAmount,
      fxRate: currency === "USD" || inv.amount === 0 ? null : usdAmount / inv.amount,
      sourceMessageId: messageId,
      createdById: actorId ?? null,
      updatedById: actorId ?? null,
      document: { create: { filename: src.filename, data: Buffer.from(src.data) } },
    },
  });
  await prisma.importReview.updateMany({ where: { messageId }, data: { status: "IMPORTED" } });
  if (!client.alias) await prisma.client.update({ where: { id: client.id }, data: { alias: inv.clientName.toUpperCase() } });

  return { status: "imported", invoiceId: created.id, number: inv.number, client: client.name };
}

export function mailboxConfigured() {
  return Boolean(process.env.IMAP_HOST && process.env.IMAP_USER && process.env.IMAP_PASSWORD);
}

/** Reads recent messages from the invoice mailbox and imports PDF attachments.
 *  Dedupe is by Message-ID, so re-reading the same window is safe. */
export async function fetchMailbox(days = 40, actorId?: string) {
  if (!mailboxConfigured()) throw new Error("Mailbox is not configured. Set IMAP_HOST, IMAP_USER and IMAP_PASSWORD.");
  const { ImapFlow } = await import("imapflow");
  const { simpleParser } = await import("mailparser");
  const prefix = (process.env.IMAP_SUBJECT_PREFIX ?? "Invoice on").toLowerCase();

  const client = new ImapFlow({
    host: process.env.IMAP_HOST!,
    port: Number(process.env.IMAP_PORT ?? 993),
    secure: (process.env.IMAP_PORT ?? "993") === "993",
    auth: { user: process.env.IMAP_USER!, pass: process.env.IMAP_PASSWORD! },
    logger: false,
  });

  const outcomes: (ImportOutcome & { subject: string })[] = [];
  await client.connect();
  const lock = await client.getMailboxLock(process.env.IMAP_FOLDER || "INBOX");
  try {
    const since = new Date(Date.now() - days * 86_400_000);
    const uids = (await client.search({ since }, { uid: true })) || [];
    for (const uid of uids) {
      const msg = await client.fetchOne(String(uid), { source: true, envelope: true }, { uid: true });
      if (!msg || !msg.source) continue;
      const subject = msg.envelope?.subject ?? "";
      const bare = subject.replace(/^(\s*(fwd?|fw|re)\s*:\s*)+/i, "").toLowerCase();
      if (prefix && !bare.startsWith(prefix)) continue;
      const mail = await simpleParser(msg.source);
      const pdfs = mail.attachments.filter((a) => a.contentType === "application/pdf" || a.filename?.toLowerCase().endsWith(".pdf"));
      for (const a of pdfs) {
        const outcome = await importSystemPdf({
          data: new Uint8Array(a.content),
          filename: a.filename ?? "invoice.pdf",
          messageId: `${mail.messageId ?? `uid-${uid}`}:${a.filename ?? ""}`,
          subject,
          receivedAt: mail.date ?? null,
        }, undefined, actorId);
        outcomes.push({ ...outcome, subject });
      }
    }
  } finally {
    lock.release();
    await client.logout().catch(() => undefined);
  }
  return outcomes;
}
