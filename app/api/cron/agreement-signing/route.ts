import { NextResponse } from "next/server";
import { logSigningEvent, newSignToken, signingTitle, signLink } from "@/lib/agreements/signing";
import { getSigningSettings } from "@/lib/agreements/signing-settings";
import { prisma } from "@/lib/db";
import { sendAgreementReminderEmail } from "@/lib/email";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const DAY = 24 * 60 * 60 * 1000;

/** Daily nudge for signers who haven't signed yet: one reminder every few days, up to a limit.
 *  Only the token's hash is stored, so each reminder carries a fresh link and the previous one stops working. */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const started = Date.now();
  const settings = await getSigningSettings();
  if (settings.maxReminders === 0) return NextResponse.json({ due: 0, sent: 0, failed: 0, off: true });
  const due = new Date(started - settings.reminderIntervalDays * DAY);
  const signers = await prisma.agreementSigner.findMany({
    where: {
      status: { in: ["PENDING", "VIEWED"] },
      reminderCount: { lt: settings.maxReminders },
      agreement: { status: "SENT" },
      OR: [{ lastReminderAt: { lte: due } }, { lastReminderAt: null, agreement: { sentAt: { lte: due } } }],
    },
    orderBy: { createdAt: "asc" },
    take: 50,
    select: {
      id: true,
      name: true,
      email: true,
      agreement: { select: { id: true, agreementRef: true, template: { select: { name: true, code: true } }, client: { select: { name: true } } } },
    },
  });

  let sent = 0;
  let failed = 0;
  for (const s of signers) {
    if (Date.now() - started > 45_000) break;
    const issued = newSignToken(settings.linkDays);
    await prisma.agreementSigner.update({
      where: { id: s.id },
      data: { tokenHash: issued.tokenHash, tokenExpiresAt: issued.tokenExpiresAt, lastReminderAt: new Date(), reminderCount: { increment: 1 } },
    });
    const res = await sendAgreementReminderEmail(s.email, {
      signerName: s.name,
      title: signingTitle(s.agreement),
      senderName: "STAR SAAS",
      link: signLink(issued.token, settings.appUrl),
      expiresAt: issued.tokenExpiresAt,
    });
    const emailed = res.mocked ? "logged" : res.sent ? "sent" : "failed";
    if (emailed === "failed") failed++;
    else sent++;
    await logSigningEvent(s.agreement.id, "reminder", s.id, { email: s.email, emailed });
  }
  return NextResponse.json({ due: signers.length, sent, failed });
}
