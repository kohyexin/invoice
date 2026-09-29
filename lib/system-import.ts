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

export type MailboxItem = { uid: number; subject: string };
export type MailboxOutcome = ImportOutcome & { subject: string };

const MAILBOX_DAYS = 40;

/** Opens the invoice mailbox, runs `fn`, and always releases the lock and logs out. */
async function withMailbox<T>(fn: (client: import("imapflow").ImapFlow) => Promise<T>): Promise<T> {
  if (!mailboxConfigured()) throw new Error("Mailbox is not configured. Set IMAP_HOST, IMAP_USER and IMAP_PASSWORD.");
  const { ImapFlow } = await import("imapflow");
  const client = new ImapFlow({
    host: process.env.IMAP_HOST!,
    port: Number(process.env.IMAP_PORT ?? 993),
    secure: (process.env.IMAP_PORT ?? "993") === "993",
    // Google displays app passwords in groups of four; the spaces are not part of the password.
    auth: { user: process.env.IMAP_USER!, pass: process.env.IMAP_PASSWORD!.replace(/\s+/g, "") },
    logger: false,
  });
  client.on("error", () => undefined);
  try {
    await client.connect();
  } catch (e) {
    const err = e as { authenticationFailed?: boolean; responseText?: string; message?: string };
    if (err.authenticationFailed) throw new Error("The mailbox rejected the sign-in. Check IMAP_USER and the app password.");
    throw new Error(err.responseText || err.message || "Couldn't connect to the mailbox.");
  }
  const lock = await client.getMailboxLock(process.env.IMAP_FOLDER || "INBOX");
  try {
    return await fn(client);
  } finally {
    lock.release();
    await client.logout().catch(() => undefined);
  }
}

function subjectMatches(subject: string) {
  const prefix = (process.env.IMAP_SUBJECT_PREFIX ?? "Invoice on").toLowerCase();
  const bare = subject.replace(/^(\s*(fwd?|fw|re)\s*:\s*)+/i, "").toLowerCase();
  return !prefix || bare.startsWith(prefix);
}

/** Lists invoice emails from the last `days` days that haven't been processed yet.
 *  Reads envelopes only, so it stays fast even with a full inbox. */
export async function listMailbox(days = MAILBOX_DAYS): Promise<{ items: MailboxItem[]; alreadyDone: number }> {
  const since = new Date(Date.now() - days * 86_400_000);
  const found = await withMailbox(async (client) => {
    const uids = (await client.search({ since }, { uid: true })) || [];
    const out: (MailboxItem & { messageId: string })[] = [];
    if (!uids.length) return out;
    for await (const msg of client.fetch(uids, { envelope: true }, { uid: true })) {
      const subject = msg.envelope?.subject ?? "";
      if (subjectMatches(subject)) out.push({ uid: msg.uid, subject, messageId: msg.envelope?.messageId ?? `uid-${msg.uid}` });
    }
    return out;
  });
  if (!found.length) return { items: [], alreadyDone: 0 };

  const [invoices, reviews] = await Promise.all([
    prisma.invoice.findMany({ where: { sourceMessageId: { not: null }, createdAt: { gte: since } }, select: { sourceMessageId: true } }),
    prisma.importReview.findMany({ where: { status: { not: "PENDING" }, createdAt: { gte: since } }, select: { messageId: true } }),
  ]);
  const done = [...invoices.map((i) => i.sourceMessageId!), ...reviews.map((r) => r.messageId)];
  const processed = (messageId: string) => done.some((d) => d.startsWith(`${messageId}:`));

  const items = found.filter((f) => !processed(f.messageId)).map(({ uid, subject }) => ({ uid, subject }));
  return { items, alreadyDone: found.length - items.length };
}

/** Downloads the given messages and imports their PDF attachments. */
export async function importMailboxUids(uids: number[], actorId?: string): Promise<MailboxOutcome[]> {
  if (!uids.length) return [];
  const { simpleParser } = await import("mailparser");
  return withMailbox(async (client) => {
    const outcomes: MailboxOutcome[] = [];
    for (const uid of uids) {
      const msg = await client.fetchOne(String(uid), { source: true, envelope: true }, { uid: true });
      if (!msg || !msg.source) continue;
      const subject = msg.envelope?.subject ?? "";
      const mail = await simpleParser(msg.source);
      const pdfs = mail.attachments.filter((a) => a.contentType === "application/pdf" || a.filename?.toLowerCase().endsWith(".pdf"));
      if (!pdfs.length) outcomes.push({ status: "skipped", reason: "No PDF attached.", subject });
      for (const a of pdfs) {
        const outcome = await importSystemPdf(
          {
            data: new Uint8Array(a.content),
            filename: a.filename ?? "invoice.pdf",
            messageId: `${mail.messageId ?? `uid-${uid}`}:${a.filename ?? ""}`,
            subject,
            receivedAt: mail.date ?? null,
          },
          undefined,
          actorId
        );
        outcomes.push({ ...outcome, subject });
      }
    }
    return outcomes;
  });
}

/** Scheduled run: imports as much as fits in `budgetMs`. Whatever is left is picked up next run. */
export async function fetchMailbox(budgetMs = 45_000, actorId?: string) {
  const started = Date.now();
  const { items, alreadyDone } = await listMailbox();
  const outcomes: MailboxOutcome[] = [];
  let next = 0;
  while (next < items.length && Date.now() - started < budgetMs) {
    const batch = items.slice(next, next + 5).map((i) => i.uid);
    outcomes.push(...(await importMailboxUids(batch, actorId)));
    next += batch.length;
  }
  return { outcomes, alreadyDone, remaining: items.length - next };
}