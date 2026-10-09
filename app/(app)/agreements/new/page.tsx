import { PageHeader } from "@/components/ui/page-header";
import { isInput, joinAddress, parseFieldConfig, type ClientDetails } from "@/lib/agreements/fields";
import { joinUrls, splitUrls } from "@/lib/client-import";
import { prisma } from "@/lib/db";
import { requirePage } from "@/lib/session";
import { toDateInput } from "@/lib/utils";
import { AgreementForm } from "./agreement-form";

export default async function NewAgreementPage({ searchParams }: { searchParams: { client?: string; template?: string } }) {
  await requirePage("agreements", "EDIT");
  const [templates, clients] = await Promise.all([
    prisma.agreementTemplate.findMany({
      where: { active: true },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      select: { id: true, name: true, code: true, fieldConfig: true },
    }),
    prisma.client.findMany({
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        agreementNo: true,
        agreementDate: true,
        country: true,
        incorporationNo: true,
        address1: true,
        address2: true,
        address3: true,
        city: true,
        directorName: true,
        contactTitle: true,
        contactEmail: true,
        websiteUrls: true,
        fees: true,
      },
    }),
  ]);

  return (
    <>
      <PageHeader
        breadcrumb="Agreements"
        breadcrumbHref="/agreements"
        title="New agreement"
        subtitle="Fill in an agreement template. Saving files the PDF and adds the details to the client, or creates the client."
      />
      <AgreementForm
        templates={templates.map((t) => ({ id: t.id, name: t.name, code: t.code, fields: parseFieldConfig(t.fieldConfig).filter(isInput) }))}
        clients={clients.map(
          (c): ClientDetails => ({
            ...c,
            address: joinAddress([c.address1, c.address2, c.address3]),
            websiteUrls: joinUrls(splitUrls(c.websiteUrls)),
            agreementDate: toDateInput(c.agreementDate),
            fees: (c.fees as Record<string, string>) ?? {},
          })
        )}
        initialTemplateId={searchParams.template ?? templates[0]?.id ?? ""}
        initialClientId={searchParams.client ?? null}
      />
    </>
  );
}
