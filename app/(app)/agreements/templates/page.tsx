import { PageHeader } from "@/components/ui/page-header";
import { isInput, parseFieldConfig } from "@/lib/agreements/fields";
import { prisma } from "@/lib/db";
import { requirePage } from "@/lib/session";
import { TemplatesView } from "./templates-view";

export default async function AgreementTemplatesPage() {
  await requirePage("agreements", "EDIT");
  const templates = await prisma.agreementTemplate.findMany({
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    select: { id: true, name: true, code: true, active: true, pdfFilename: true, fieldConfig: true, updatedAt: true, _count: { select: { agreements: true } } },
  });
  const rows = templates.map((t) => {
    const fields = parseFieldConfig(t.fieldConfig);
    return {
      id: t.id,
      name: t.name,
      code: t.code,
      active: t.active,
      pdfFilename: t.pdfFilename,
      fields: fields.filter(isInput).length,
      mapped: fields.filter((f) => isInput(f) && f.clientKey).length,
      agreements: t._count.agreements,
      updatedAt: t.updatedAt.toISOString(),
    };
  });

  return (
    <>
      <PageHeader
        breadcrumb="Agreements"
        breadcrumbHref="/agreements"
        title="Agreement templates"
        subtitle="Blank agreement PDFs with fillable fields. Set up each field once: its label, whether it is required, and which client detail it fills."
      />
      <TemplatesView rows={rows} />
    </>
  );
}
