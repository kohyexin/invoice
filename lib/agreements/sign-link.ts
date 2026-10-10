import "server-only";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { sha256 } from "@/lib/mfa";

/* Looking up a signing link for the public /api/sign routes. */

/** Per IP, a few dozen requests a minute, in this server instance. */
const hits = new Map<string, number[]>();
export function rateLimited(req: Request) {
  const ip = clientIp(req);
  const now = Date.now();
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < 60_000);
  recent.push(now);
  hits.set(ip, recent);
  if (hits.size > 5_000) hits.clear();
  return recent.length > 40;
}

export function clientIp(req: Request) {
  return req.headers.get("x-forwarded-for")?.split(",")[0].trim() || req.headers.get("x-real-ip") || "unknown";
}

/** The signer a link belongs to, or the response to send when it's unknown or expired.
 *  Expired links still open a completed agreement, so signers can fetch their copy. */
export async function findSigner(token: string) {
  const signer = await prisma.agreementSigner.findUnique({
    where: { tokenHash: sha256(token) },
    select: {
      id: true,
      roleKey: true,
      roleLabel: true,
      name: true,
      email: true,
      status: true,
      tokenExpiresAt: true,
      agreement: {
        select: {
          id: true,
          status: true,
          agreementRef: true,
          templateId: true,
          template: { select: { name: true, code: true, fieldConfig: true } },
          client: { select: { name: true } },
          signers: { orderBy: { createdAt: "asc" }, select: { id: true, roleLabel: true, name: true, status: true } },
        },
      },
    },
  });
  if (!signer) return { error: NextResponse.json({ error: "This signing link isn't valid any more." }, { status: 404 }) };
  if (signer.tokenExpiresAt < new Date() && signer.agreement.status !== "COMPLETED") {
    return { error: NextResponse.json({ error: "This signing link has expired. Ask the sender for a new one." }, { status: 410 }) };
  }
  return { signer };
}
