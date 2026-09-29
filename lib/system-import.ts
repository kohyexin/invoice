import "server-only";
import { createHash } from "node:crypto";
import { prisma } from "@/lib/db";
import type { Currency, ReviewStatus } from "@/lib/generated/prisma/client";
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

/** What reading one PDF did. Reading never posts to the ledger; only approval does.
 *  - queued: new, now waiting for approval
 *  - waiting: already waiting for approval from an earlier check
 *  - rejected: rejected before (same email, or same invoice number)
 *  - imported: approved and posted before
 *  - duplicate: the invoice number is already on the ledger */
export type StageStatus = "queued" | "waiting" | "rejected" | "imported" | "duplicate" | "skipped";
export type StageOutcome = { status: StageStatus; number?: string; client?: string; reason?: string };

const STATUS_OF: Record<ReviewStatus, StageStatus> = {
  PENDING: "waiting",
  DISMISSED: "rejected",
  IMPORTED: "imported",
  DUPLICATE: "duplicate",
};

const norm = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, "");

async function matchClient(inv: Partial<SystemInvoice>): Promise<{ id: string; name: string } | { reason: string }> {
  if (inv.reference) {
    const byRef = await prisma.client.findMany({ where: { agreementNo: { equals: inv.reference, mode: "insensitive" } }, select: { id: true, name: true } });
    if (byRef.length === 1) return byRef[0];
    if (byRef.length > 1) return { reason: `Reference ${inv.reference} matches ${byRef.length} clients.` };
  }
  if (inv.clientName) {
    const key = norm(inv.clientName);
    const all = await prisma.client.findMany({ select: { id: true, alias: true, name: true } });
    const hits = all.filter((c) => (c.alias && norm(c.alias) === key) || norm(c.name) === key);
    if (hits.length === 1) return hits[0];
    if (hits.length > 1) return { reason: `Client name ${inv.clientName} matches ${hits.length} clients.` };
  }
  return { reason: `No client with reference ${inv.reference || "—"} or alias ${inv.clientName || "—"}.` };
}

/** Reads one system-invoice PDF and files it for review. Never touches the ledger,
 *  except to attach the PDF to an invoice that is already there. */
export async function stageSystemPdf(src: ImportSource): Promise<StageOutcome> {
  const messageId = src.messageId ?? `upload:${createHash("sha256").update(src.data).digest("hex").slice(0, 32)}`;

  const [posted, known] = await Promise.all([
    prisma.invoice.findUnique({ where: { sourceMessageId: messageId }, select: { number: true } }),
    prisma.importReview.findUnique({ where: { messageId }, select: { status: true, invoiceNumber: true, reason: true } }),
  ]);
  if (posted) return { status: "imported", number: posted.number };
  if (known) return { status: STATUS_OF[known.status], number: known.invoiceNumber ?? undefined, reason: known.reason || undefined };

  const base = {
    messageId,
    subject: src.subject ?? "",
    receivedAt: src.receivedAt ?? null,
    filename: src.filename,
    pdf: Buffer.from(src.data),
  };

  let text: string;
  try {
    text = await extractPdfText(src.data);
  } catch {
    const reason = "The attachment could not be read as a PDF.";
    await prisma.importReview.create({ data: { ...base, reason } });
    return { status: "queued", reason };
  }
  const parsed = parseSystemInvoiceText(text);
  if (!parsed.ok) {
    await prisma.importReview.create({ data: { ...base, parsed: parsed.partial, invoiceNumber: parsed.partial.number || null, reason: parsed.error } });
    return { status: "queued", number: parsed.partial.number || undefined, reason: parsed.error };
  }
  const inv = parsed.invoice;

  const [onLedger, earlier] = await Promise.all([
    prisma.invoice.findFirst({ where: { number: inv.number }, select: { id: true, document: { select: { id: true } } } }),
    prisma.importReview.findFirst({
      where: { invoiceNumber: inv.number, status: { in: ["PENDING", "DISMISSED"] } },
      orderBy: { createdAt: "desc" },
      select: { status: true },
    }),
  ]);
  const withInvoice = { ...base, parsed: inv, invoiceNumber: inv.number };

  if (onLedger) {
    if (!onLedger.document) {
      await prisma.invoiceDocument.create({ data: { invoiceId: onLedger.id, filename: src.filename, data: Buffer.from(src.data) } });
    }
    await prisma.importReview.create({ data: { ...withInvoice, status: "DUPLICATE", invoiceId: onLedger.id, reason: "Already in the ledger." } });
    return { status: "duplicate", number: inv.number };
  }
  if (earlier?.status === "DISMISSED") {
    const reason = "Rejected before (same invoice number).";
    await prisma.importReview.create({ data: { ...withInvoice, status: "DISMISSED", reason } });
    return { status: "rejected", number: inv.number, reason };
  }
  if (earlier?.status === "PENDING") {
    const reason = "Same invoice as one already waiting for approval.";
    await prisma.importReview.create({ data: { ...withInvoice, status: "DUPLICATE", reason } });
    return { status: "waiting", number: inv.number, reason };
  }

  const match = await matchClient(inv);
  const client = "id" in match ? match : null;
  const reason = client ? "" : (match as { reason: string }).reason;
  await prisma.importReview.create({ data: { ...withInvoice, clientId: client?.id ?? null, reason } });
  return { status: "queued", number: inv.number, client: client?.name, reason: reason || undefined };
}

/** Posts an approved review item to the ledger. */
export async function approveReview(id: string, clientId: string, actorId: string): Promise<{ ok: true; number: string } | { ok: false; error: string }> {
  const row = await prisma.importReview.findUnique({ where: { id } });
  if (!row || row.status !== "PENDING") return { ok: false, error: "This item was already handled." };
  if (!row.pdf) return { ok: false, error: "The PDF for this item is missing." };
  if (!clientId) return { ok: false, error: "Pick a client." };

  let parsed: ReturnType<typeof parseSystemInvoiceText>;
  try {
    parsed = parseSystemInvoiceText(await extractPdfText(new Uint8Array(row.pdf)));
  } catch {
    return { ok: false, error: "The attachment could not be read as a PDF." };
  }
  if (!parsed.ok) return { ok: false, error: parsed.error };
  const inv = parsed.invoice;

  const existing = await prisma.invoice.findFirst({ where: { number: inv.number }, select: { id: true } });
  if (existing) {
    await prisma.importReview.update({ where: { id }, data: { status: "DUPLICATE", invoiceId: existing.id, reason: "Already in the ledger." } });
    return { ok: false, error: "This invoice number is already in the ledger." };
  }

  const [client, last] = await Promise.all([
    prisma.client.findUnique({ where: { id: clientId }, select: { id: true, name: true, alias: true, defaultOwnerId: true } }),
    prisma.invoice.findFirst({
      where: { clientId, generate: "SYSTEM" },
      orderBy: { invoiceDate: "desc" },
      select: { typeId: true, subtype: true, ownerId: true },
    }),
  ]);
  if (!client) return { ok: false, error: "Pick a client." };

  const currency: Currency = (CURRENCIES as readonly string[]).includes(inv.currency) ? (inv.currency as Currency) : "USD";
  const usdAmount = toUsd(inv.amount, currency, await fxRates());
  if (usdAmount === null) return { ok: false, error: `No FX rate for ${currency}.` };

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
      sourceMessageId: row.messageId,
      createdById: actorId,
      updatedById: actorId,
      document: { create: { filename: row.filename, data: Buffer.from(row.pdf) } },
    },
  });
  await prisma.importReview.update({
    where: { id },
    data: { status: "IMPORTED", invoiceId: created.id, clientId: client.id, reason: "", decidedAt: new Date(), decidedById: actorId },
  });
  if (!client.alias) await prisma.client.update({ where: { id: client.id }, data: { alias: inv.clientName.toUpperCase() } });

  return { ok: true, number: inv.number };
}

export async function rejectReview(id: string, actorId: string) {
  await prisma.importReview.updateMany({ where: { id, status: "PENDING" }, data: { status: "DISMISSED", decidedAt: new Date(), decidedById: actorId } });
}

/** Puts a rejected item back in the approval queue. */
export async function restoreReview(id: string) {
  const row = await prisma.importReview.findUnique({ where: { id }, select: { status: true, parsed: true, clientId: true } });
  if (!row || row.status !== "DISMISSED") return;
  const inv = (row.parsed ?? {}) as Partial<SystemInvoice>;
  let clientId = row.clientId;
  let reason = "";
  if (!inv.number) reason = "No invoice number found.";
  else if (!clientId) {
    const match = await matchClient(inv);
    if ("id" in match) clientId = match.id;
    else reason = match.reason;
  }
  await prisma.importReview.update({ where: { id }, data: { status: "PENDING", clientId, reason, decidedAt: null, decidedById: null } });
}

export function mailboxConfigured() {
  return Boolean(process.env.IMAP_HOST && process.env.IMAP_USER && process.env.IMAP_PASSWORD);
}

export type MailboxItem = { uid: number; subject: string };
export type MailboxOutcome = StageOutcome & { subject: string };

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

const stripReplyPrefix = (s: string) => s.replace(/^(\s*(fwd?|fw|re)\s*:\s*)+/i, "").trim().toLowerCase();

function subjectMatches(subject: string) {
  const prefix = stripReplyPrefix(process.env.IMAP_SUBJECT_PREFIX ?? "Invoice on");
  return !prefix || stripReplyPrefix(subject).startsWith(prefix);
}

export type KnownCounts = { waiting: number; rejected: number; imported: number; duplicate: number };
export type MailboxScan = {
  items: MailboxItem[];
  known: KnownCounts;
  /** Emails in this check that were rejected before, so the reviewer sees them without re-approving. */
  rejected: { subject: string; number: string | null }[];
  seen: number;
  otherSubjects: string[];
};

/** Lists invoice emails from the last `days` days and sorts out which ones are new.
 *  Reads envelopes only, so it stays fast even with a full inbox. */
export async function listMailbox(days = MAILBOX_DAYS): Promise<MailboxScan> {
  const since = new Date(Date.now() - days * 86_400_000);
  const { found, seen, otherSubjects } = await withMailbox(async (client) => {
    const uids = (await client.search({ since }, { uid: true })) || [];
    const found: (MailboxItem & { messageId: string })[] = [];
    const otherSubjects: string[] = [];
    if (!uids.length) return { found, seen: 0, otherSubjects };
    for await (const msg of client.fetch(uids, { envelope: true }, { uid: true })) {
      const subject = msg.envelope?.subject ?? "";
      if (subjectMatches(subject)) found.push({ uid: msg.uid, subject, messageId: msg.envelope?.messageId ?? `uid-${msg.uid}` });
      else otherSubjects.push(subject);
    }
    return { found, seen: uids.length, otherSubjects: otherSubjects.slice(-5).reverse() };
  });

  const known: KnownCounts = { waiting: 0, rejected: 0, imported: 0, duplicate: 0 };
  const rejected: MailboxScan["rejected"] = [];
  if (!found.length) return { items: [], known, rejected, seen, otherSubjects };

  const [posted, reviews] = await Promise.all([
    prisma.invoice.findMany({ where: { sourceMessageId: { not: null }, createdAt: { gte: since } }, select: { sourceMessageId: true } }),
    prisma.importReview.findMany({ where: { createdAt: { gte: since } }, select: { messageId: true, status: true, invoiceNumber: true } }),
  ]);

  const items: MailboxItem[] = [];
  for (const f of found) {
    const key = `${f.messageId}:`;
    const rows = reviews.filter((r) => r.messageId.startsWith(key));
    const wasPosted = posted.some((p) => p.sourceMessageId!.startsWith(key));
    if (!rows.length && !wasPosted) {
      items.push({ uid: f.uid, subject: f.subject });
    } else if (wasPosted || rows.some((r) => r.status === "IMPORTED")) {
      known.imported++;
    } else if (rows.some((r) => r.status === "DISMISSED")) {
      known.rejected++;
      rejected.push({ subject: f.subject, number: rows.find((r) => r.invoiceNumber)?.invoiceNumber ?? null });
    } else if (rows.some((r) => r.status === "PENDING")) {
      known.waiting++;
    } else {
      known.duplicate++;
    }
  }
  return { items, known, rejected, seen, otherSubjects };
}

/** Downloads the given messages and files their PDF attachments for review. */
export async function stageMailboxUids(uids: number[]): Promise<MailboxOutcome[]> {
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
        const outcome = await stageSystemPdf({
          data: new Uint8Array(a.content),
          filename: a.filename ?? "invoice.pdf",
          messageId: `${mail.messageId ?? `uid-${uid}`}:${a.filename ?? ""}`,
          subject,
          receivedAt: mail.date ?? null,
        });
        outcomes.push({ ...outcome, subject });
      }
    }
    return outcomes;
  });
}

/** Scheduled run: files as many new emails for review as fit in `budgetMs`.
 *  Whatever is left is picked up next run. */
export async function fetchMailbox(budgetMs = 45_000) {
  const started = Date.now();
  const { items, known } = await listMailbox();
  const outcomes: MailboxOutcome[] = [];
  let next = 0;
  while (next < items.length && Date.now() - started < budgetMs) {
    const batch = items.slice(next, next + 5).map((i) => i.uid);
    outcomes.push(...(await stageMailboxUids(batch)));
    next += batch.length;
  }
  return { outcomes, known, remaining: items.length - next };
}
