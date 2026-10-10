import { PageHeader } from "@/components/ui/page-header";
import { prisma } from "@/lib/db";
import { requirePage } from "@/lib/session";
import { AgreementsView } from "./agreements-view";

export default async function AgreementsPage() {
  await requirePage("agreements");
  const agreements = await prisma.agreement.findMany({
    orderBy: [{ finalizedAt: "desc" }, { createdAt: "desc" }],
    select: {
      id: true,
      agreementRef: true,
      status: true,
      finalizedAt: true,
      createdAt: true,
      template: { select: { name: true, code: true } },
      client: { select: { id: true, name: true } },
      createdBy: { select: { name: true } },
      documents: { where: { variant: "FILLED" }, select: { driveFileId: true, data: true } },
      signers: { orderBy: { createdAt: "asc" }, select: { name: true, roleLabel: true, status: true, signedAt: true } },
    },
  });

  const rows = agreements.map((a) => ({
    id: a.id,
    agreementRef: a.agreementRef,
    status: a.status,
    date: (a.finalizedAt ?? a.createdAt).toISOString(),
    template: a.template.name,
    templateCode: a.template.code,
    clientId: a.client.id,
    client: a.client.name,
    createdBy: a.createdBy?.name ?? "",
    onDrive: a.documents.some((d) => d.driveFileId && !d.data),
    signers: a.signers.map((s) => ({ name: s.name, roleLabel: s.roleLabel, signed: s.status === "SIGNED", signedAt: s.signedAt?.toISOString() ?? null })),
  }));

  return (
    <>
      <PageHeader title="Agreements" subtitle={`${rows.length} agreements. Each one is filed on Google Drive and linked to its client.`} />
      <AgreementsView rows={rows} />
    </>
  );
}
