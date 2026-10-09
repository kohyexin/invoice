import { notFound } from "next/navigation";
import { PageHeader } from "@/components/ui/page-header";
import { isInput, parseFieldConfig } from "@/lib/agreements/fields";
import { prisma } from "@/lib/db";
import { requirePage } from "@/lib/session";
import { AgreementDetail } from "./agreement-detail";

export default async function AgreementPage({ params }: { params: { id: string } }) {
  await requirePage("agreements");
  const a = await prisma.agreement.findUnique({
    where: { id: params.id },
    select: {
      id: true,
      agreementRef: true,
      status: true,
      values: true,
      finalizedAt: true,
      createdAt: true,
      template: { select: { name: true, code: true, fieldConfig: true } },
      client: { select: { id: true, name: true } },
      createdBy: { select: { name: true } },
      documents: { select: { variant: true, filename: true, driveFileId: true, data: true, syncError: true } },
    },
  });
  if (!a) notFound();

  const values = (a.values ?? {}) as Record<string, string>;
  const filled = a.documents.find((d) => d.variant === "FILLED");

  return (
    <>
      <PageHeader
        breadcrumb="Agreements"
        breadcrumbHref="/agreements"
        title={a.agreementRef || a.template.name}
        subtitle={`${a.template.name} · ${a.client.name}`}
      />
      <AgreementDetail
        agreement={{
          id: a.id,
          status: a.status,
          date: (a.finalizedAt ?? a.createdAt).toISOString(),
          template: a.template.name,
          client: a.client,
          createdBy: a.createdBy?.name ?? "",
          values: parseFieldConfig(a.template.fieldConfig)
            .filter(isInput)
            .map((f) => ({ label: f.label, type: f.type, value: values[f.pdfFieldName] ?? "" })),
          document: filled
            ? { filename: filled.filename, driveFileId: filled.data ? null : filled.driveFileId, syncError: filled.syncError }
            : null,
        }}
      />
    </>
  );
}
