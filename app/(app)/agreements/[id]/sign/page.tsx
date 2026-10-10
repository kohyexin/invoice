import { notFound, redirect } from "next/navigation";
import { PageHeader } from "@/components/ui/page-header";
import { parseFieldConfig } from "@/lib/agreements/fields";
import { logSigningEvent, signatureBoxes, signerFields, signingTitle } from "@/lib/agreements/signing";
import { prisma } from "@/lib/db";
import { readDocument } from "@/lib/documents";
import { requirePage } from "@/lib/session";
import { InAppSign } from "./in-app-sign";

/** Signing inside the app, for a signer who is the signed-in user. */
export default async function SignAgreementPage({ params }: { params: { id: string } }) {
  const me = await requirePage("agreements");
  const a = await prisma.agreement.findUnique({
    where: { id: params.id },
    select: {
      id: true,
      status: true,
      agreementRef: true,
      templateId: true,
      template: { select: { name: true, fieldConfig: true } },
      client: { select: { name: true } },
      documents: { where: { variant: "FILLED" }, select: { data: true, driveFileId: true } },
      signers: { orderBy: { createdAt: "asc" }, select: { id: true, roleKey: true, roleLabel: true, name: true, email: true, status: true } },
    },
  });
  if (!a) notFound();
  const signer = a.signers.find((s) => s.email.toLowerCase() === me.email.toLowerCase() && s.status !== "SIGNED");
  if (a.status !== "SENT" || !signer) redirect(`/agreements/${a.id}`);

  const filled = a.documents[0] ? await readDocument(a.documents[0]) : null;
  const names = signerFields(parseFieldConfig(a.template.fieldConfig), signer.roleKey).map((f) => f.pdfFieldName);
  const boxes = filled ? (await signatureBoxes(filled, a.templateId, names)).map(({ page, x, y, width, height }) => ({ page, x, y, width, height })) : [];

  if (signer.status === "PENDING") {
    const first = await prisma.agreementSigner.updateMany({ where: { id: signer.id, status: "PENDING" }, data: { status: "VIEWED", openedAt: new Date() } });
    if (first.count) await logSigningEvent(a.id, "viewed", signer.id, { via: "app" });
  }

  const title = signingTitle(a);
  return (
    <>
      <PageHeader breadcrumb="Agreements" breadcrumbHref={`/agreements/${a.id}`} title="Sign agreement" subtitle={title} />
      <InAppSign
        agreementId={a.id}
        signerId={signer.id}
        signerName={signer.name}
        roleLabel={signer.roleLabel}
        boxes={boxes}
        others={a.signers.filter((s) => s.id !== signer.id).map((s) => ({ roleLabel: s.roleLabel, name: s.name, signed: s.status === "SIGNED" }))}
      />
    </>
  );
}
