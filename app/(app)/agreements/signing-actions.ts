"use server";

import { revalidatePath } from "next/cache";
import { logActivity } from "@/lib/activity";
import { parseFieldConfig, signerRoleLabel, templateSignerRoles } from "@/lib/agreements/fields";
import { headers } from "next/headers";
import { logSigningEvent, newSignToken, recordSignature, signingTitle, signLink, type SignatureInput } from "@/lib/agreements/signing";
import { getSigningSettings } from "@/lib/agreements/signing-settings";
import { prisma } from "@/lib/db";
import { sendAgreementSignerReplacedEmail, sendAgreementSignRequestEmail } from "@/lib/email";
import { authorize } from "@/lib/session";

type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };

export type SignerInput = { roleKey: string; name: string; email: string };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const agreementSelect = {
  id: true,
  status: true,
  agreementRef: true,
  template: { select: { name: true, code: true, fieldConfig: true } },
  client: { select: { name: true } },
  documents: { where: { variant: "FILLED" as const }, select: { id: true } },
};

/** Links handed back to the sender when email isn't set up (development only), so they can be passed on by hand. */
export type LoggedLink = { name: string; link: string };

async function emailSigner(signer: { name: string; email: string }, token: string, expiresAt: Date, title: string, senderName: string, appUrl: string) {
  const link = signLink(token, appUrl);
  const res = await sendAgreementSignRequestEmail(signer.email, { signerName: signer.name, title, senderName, link, expiresAt });
  return { emailed: res.mocked ? "logged" : res.sent ? "sent" : "failed", link };
}

/** Emails every signer their own link at once and marks the agreement out for signature. */
export async function sendForSignature(agreementId: string, input: SignerInput[]): Promise<Result<{ failed: string[]; logged: LoggedLink[] }>> {
  const auth = await authorize("agreements", "EDIT");
  if (!auth.ok) return auth;
  const a = await prisma.agreement.findUnique({ where: { id: agreementId }, select: agreementSelect });
  if (!a) return { ok: false, error: "Agreement not found." };
  if (a.status !== "FINALIZED") return { ok: false, error: "This agreement has already been sent for signature." };
  if (a.documents.length === 0) return { ok: false, error: "This agreement's PDF is missing." };
  const roles = templateSignerRoles(parseFieldConfig(a.template.fieldConfig));
  if (roles.length === 0) return { ok: false, error: "The template has no signature fields. Place them on the template first." };

  const signers = roles.map((roleKey) => {
    const s = input.find((x) => x.roleKey === roleKey);
    return { roleKey, roleLabel: signerRoleLabel(roleKey), name: (s?.name ?? "").trim(), email: (s?.email ?? "").trim().toLowerCase() };
  });
  const bad = signers.find((s) => !s.name || !EMAIL_RE.test(s.email));
  if (bad) return { ok: false, error: "Enter a name and a valid email for every signer." };

  const settings = await getSigningSettings();
  const issued = signers.map((s) => ({ ...s, ...newSignToken(settings.linkDays) }));
  const created = await prisma.$transaction(async (tx) => {
    const claimed = await tx.agreement.updateMany({ where: { id: agreementId, status: "FINALIZED" }, data: { status: "SENT", sentAt: new Date() } });
    if (claimed.count === 0) return null;
    return Promise.all(
      issued.map((s) =>
        tx.agreementSigner.create({
          data: { agreementId, roleKey: s.roleKey, roleLabel: s.roleLabel, name: s.name, email: s.email, tokenHash: s.tokenHash, tokenExpiresAt: s.tokenExpiresAt },
          select: { id: true },
        })
      )
    );
  });
  if (!created) return { ok: false, error: "This agreement has already been sent for signature." };

  const title = signingTitle(a);
  const failed: string[] = [];
  const logged: LoggedLink[] = [];
  for (const [i, s] of issued.entries()) {
    const { emailed, link } = await emailSigner(s, s.token, s.tokenExpiresAt, title, auth.user.name || auth.user.email, settings.appUrl);
    if (emailed === "failed") failed.push(s.name);
    if (emailed === "logged") logged.push({ name: s.name, link });
    await logSigningEvent(agreementId, "sent", created[i].id, { email: s.email, emailed });
  }
  await logActivity(auth.user, {
    action: "send",
    entity: "agreement",
    entityId: agreementId,
    label: [a.template.code, a.agreementRef, a.client.name].filter(Boolean).join(" · "),
    changes: { signers: signers.map((s) => `${s.roleLabel}: ${s.name} <${s.email}>`).join("; ") },
  });
  revalidatePath(`/agreements/${agreementId}`);
  revalidatePath("/agreements");
  return { ok: true, failed, logged };
}

const activityLabel = (a: { template: { code: string }; agreementRef: string; client: { name: string } }) =>
  [a.template.code, a.agreementRef, a.client.name].filter(Boolean).join(" · ");

async function findOpenSigner(signerId: string): Promise<Result<{ signer: { id: string; name: string; email: string; agreement: { id: string; agreementRef: string; template: { name: string; code: string }; client: { name: string } } } }>> {
  const signer = await prisma.agreementSigner.findUnique({
    where: { id: signerId },
    select: { id: true, name: true, email: true, status: true, agreement: { select: agreementSelect } },
  });
  if (!signer) return { ok: false, error: "Signer not found." };
  if (signer.agreement.status !== "SENT") return { ok: false, error: "This agreement isn't out for signature." };
  if (signer.status === "SIGNED") return { ok: false, error: "This signer has already signed." };
  return { ok: true, signer };
}

/** Emails a signer a new link; the old one stops working. */
export async function resendSignRequest(signerId: string): Promise<Result<{ emailed: string; logged: LoggedLink[] }>> {
  const auth = await authorize("agreements", "EDIT");
  if (!auth.ok) return auth;
  const found = await findOpenSigner(signerId);
  if (!found.ok) return found;
  const { signer } = found;

  const settings = await getSigningSettings();
  const issued = newSignToken(settings.linkDays);
  await prisma.agreementSigner.update({
    where: { id: signerId },
    data: { tokenHash: issued.tokenHash, tokenExpiresAt: issued.tokenExpiresAt, lastReminderAt: new Date() },
  });
  const { emailed, link } = await emailSigner(signer, issued.token, issued.tokenExpiresAt, signingTitle(signer.agreement), auth.user.name || auth.user.email, settings.appUrl);
  await logSigningEvent(signer.agreement.id, "resent", signerId, { email: signer.email, emailed });
  await logActivity(auth.user, {
    action: "resend",
    entity: "agreement",
    entityId: signer.agreement.id,
    label: activityLabel(signer.agreement),
    changes: { signer: `${signer.name} <${signer.email}>` },
  });
  revalidatePath(`/agreements/${signer.agreement.id}`);
  if (emailed === "failed") return { ok: false, error: "Couldn't send the email. Please try again." };
  return { ok: true, emailed, logged: emailed === "logged" ? [{ name: signer.name, link }] : [] };
}

/** Hands an unsigned signer's place to someone else while signing carries on:
 *  the old link stops working, the new person starts fresh with their own link,
 *  and signatures already given stay. Also how a mistyped email gets fixed. */
export async function reassignSigner(
  signerId: string,
  input: { name: string; email: string; notifyPrevious: boolean }
): Promise<Result<{ emailed: string; logged: LoggedLink[] }>> {
  const auth = await authorize("agreements", "EDIT");
  if (!auth.ok) return auth;
  const found = await findOpenSigner(signerId);
  if (!found.ok) return found;
  const { signer } = found;
  const name = input.name.trim();
  const email = input.email.trim().toLowerCase();
  if (!name || !EMAIL_RE.test(email)) return { ok: false, error: "Enter a name and a valid email." };
  if (name === signer.name && email === signer.email) return { ok: false, error: "That's who signs already. Use Resend link to send them a new one." };

  const settings = await getSigningSettings();
  const issued = newSignToken(settings.linkDays);
  const history = await prisma.agreementSigningEvent.findMany({ where: { signerId }, select: { id: true, detail: true } });
  const moved = await prisma.$transaction(async (tx) => {
    const res = await tx.agreementSigner.updateMany({
      where: { id: signerId, status: { not: "SIGNED" }, agreement: { is: { status: "SENT" } } },
      data: {
        name,
        email,
        status: "PENDING",
        openedAt: null,
        tokenHash: issued.tokenHash,
        tokenExpiresAt: issued.tokenExpiresAt,
        lastReminderAt: new Date(),
        reminderCount: 0,
      },
    });
    if (res.count === 0) return false;
    // Earlier entries name the person they were about, not whoever holds the place now.
    for (const e of history) {
      const detail = (e.detail ?? {}) as Record<string, unknown>;
      if (detail.name === undefined) await tx.agreementSigningEvent.update({ where: { id: e.id }, data: { detail: { ...detail, name: signer.name } } });
    }
    return true;
  });
  if (!moved) return { ok: false, error: "This signer has just signed, so their place can't be handed on." };

  const title = signingTitle(signer.agreement);
  const senderName = auth.user.name || auth.user.email;
  const { emailed, link } = await emailSigner({ name, email }, issued.token, issued.tokenExpiresAt, title, senderName, settings.appUrl);
  const previousNotified = input.notifyPrevious && signer.email !== email ? (await sendAgreementSignerReplacedEmail(signer.email, signer.name, title, senderName)).sent : false;
  await logSigningEvent(signer.agreement.id, "reassigned", signerId, {
    name,
    email,
    emailed,
    previous: signer.name,
    previousEmail: signer.email,
    previousNotified,
  });
  await logActivity(auth.user, {
    action: "reassign",
    entity: "agreement",
    entityId: signer.agreement.id,
    label: activityLabel(signer.agreement),
    changes: { signer: `${name} <${email}>`, previous: `${signer.name} <${signer.email}>` },
  });
  revalidatePath(`/agreements/${signer.agreement.id}`);
  if (emailed === "failed") return { ok: false, error: "Reassigned, but the email couldn't be delivered. Use Resend link to try again." };
  return { ok: true, emailed, logged: emailed === "logged" ? [{ name, link }] : [] };
}

/** Signing inside the app: only the app user whose email the signer was sent to.
 *  Their emailed link keeps working too, whichever they use first counts. */
export async function signInApp(signerId: string, input: SignatureInput): Promise<Result<{ completed: boolean }>> {
  const auth = await authorize("agreements");
  if (!auth.ok) return auth;
  const signer = await prisma.agreementSigner.findUnique({ where: { id: signerId }, select: { email: true, agreementId: true } });
  if (!signer || signer.email.toLowerCase() !== auth.user.email.toLowerCase()) return { ok: false, error: "Only the signer can sign here." };
  const h = headers();
  const res = await recordSignature(signerId, input, {
    ip: h.get("x-forwarded-for")?.split(",")[0].trim() || "app",
    userAgent: (h.get("user-agent") ?? "").slice(0, 300),
    via: "app",
    actor: auth.user,
  });
  if (!res.ok) return { ok: false, error: res.error };
  revalidatePath(`/agreements/${signer.agreementId}`);
  revalidatePath("/agreements");
  return { ok: true, completed: res.completed };
}

/** Cancels signing: every link stops working, signatures given so far are dropped,
 *  and the agreement is back to ready to send. */
export async function voidSigning(agreementId: string): Promise<Result> {
  const auth = await authorize("agreements", "EDIT");
  if (!auth.ok) return auth;
  const a = await prisma.agreement.findUnique({ where: { id: agreementId }, select: agreementSelect });
  if (!a) return { ok: false, error: "Agreement not found." };
  const voided = await prisma.$transaction(async (tx) => {
    const claimed = await tx.agreement.updateMany({ where: { id: agreementId, status: "SENT" }, data: { status: "FINALIZED", sentAt: null } });
    if (claimed.count === 0) return false;
    await tx.agreementSigner.deleteMany({ where: { agreementId } });
    return true;
  });
  if (!voided) return { ok: false, error: "This agreement isn't out for signature." };
  await logSigningEvent(agreementId, "voided", null, { by: auth.user.name || auth.user.email });
  await logActivity(auth.user, {
    action: "void",
    entity: "agreement",
    entityId: agreementId,
    label: [a.template.code, a.agreementRef, a.client.name].filter(Boolean).join(" · "),
  });
  revalidatePath(`/agreements/${agreementId}`);
  revalidatePath("/agreements");
  return { ok: true };
}
