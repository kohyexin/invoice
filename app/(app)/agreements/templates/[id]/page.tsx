import { notFound } from "next/navigation";
import { PageHeader } from "@/components/ui/page-header";
import { parseFieldConfig } from "@/lib/agreements/fields";
import { fieldBoxes } from "@/lib/agreements/pdf";
import { prisma } from "@/lib/db";
import { requirePage } from "@/lib/session";
import { TemplateSetup } from "./template-setup";

export default async function AgreementTemplatePage({ params }: { params: { id: string } }) {
  await requirePage("agreements", "EDIT");
  const template = await prisma.agreementTemplate.findUnique({
    where: { id: params.id },
    select: { id: true, name: true, code: true, active: true, pdf: true, pdfFilename: true, fieldConfig: true, updatedAt: true, _count: { select: { agreements: true } } },
  });
  if (!template) notFound();
  const boxes = await fieldBoxes(new Uint8Array(template.pdf));

  return (
    <>
      <PageHeader
        breadcrumb="Agreement templates"
        breadcrumbHref="/agreements/templates"
        title={template.name}
        subtitle={[template.code, template.pdfFilename].filter(Boolean).join(" · ")}
      />
      <TemplateSetup
        id={template.id}
        agreements={template._count.agreements}
        boxes={boxes}
        version={template.updatedAt.getTime()}
        initial={{ name: template.name, code: template.code, active: template.active, fields: parseFieldConfig(template.fieldConfig) }}
      />
    </>
  );
}
