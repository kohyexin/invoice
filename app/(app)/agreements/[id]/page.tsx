import { notFound } from "next/navigation";
import { PageHeader } from "@/components/ui/page-header";
import { isInput, parseFieldConfig, signerRoleLabel, templateSignerRoles } from "@/lib/agreements/fields";
import { signerFields } from "@/lib/agreements/signing";
import { getSigningSettings } from "@/lib/agreements/signing-settings";
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
      sentAt: true,
      completedAt: true,
      createdAt: true,
      template: { select: { name: true, code: true, fieldConfig: true } },
      client: { select: { id: true, name: true, directorName: true, contactEmail: true } },
      createdBy: { select: { name: true } },
      documents: { select: { variant: true, filename: true, driveFileId: true, data: true, syncError: true } },
      signers: {
        orderBy: { createdAt: "asc" },
        select: { id: true, roleKey: true, roleLabel: true, name: true, email: true, status: true, openedAt: true, signedAt: true, lastReminderAt: true, reminderCount: true },
      },
      events: { orderBy: { createdAt: "desc" }, take: 50, select: { id: true, type: true, detail: true, createdAt: true, signer: { select: { name: true } } } },
    },
  });
  if (!a) notFound();
  const [signing, appUsers] = await Promise.all([
    getSigningSettings(),
    prisma.user.findMany({ where: { active: true }, orderBy: { name: "asc" }, select: { name: true, email: true } }),
  ]);

  const values = (a.values ?? {}) as Record<string, string>;
  const fields = parseFieldConfig(a.template.fieldConfig);
  const doc = a.documents.find((d) => d.variant === "SIGNED") ?? a.documents.find((d) => d.variant === "FILLED");
  const valueOf = (clientKey: string) => {
    const f = fields.find((x) => x.clientKey === clientKey);
    return f ? (values[f.pdfFieldName] ?? "").trim() : "";
  };
  const defaults: Record<string, { name: string; email: string }> = {
    client: {
      name: valueOf("directorName") || a.client.directorName || "",
      email: valueOf("contactEmail") || a.client.contactEmail || "",
    },
    company: { name: signing.companySignerName, email: signing.companySignerEmail },
  };

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
          sentAt: a.sentAt?.toISOString() ?? null,
          completedAt: a.completedAt?.toISOString() ?? null,
          template: a.template.name,
          client: { id: a.client.id, name: a.client.name },
          createdBy: a.createdBy?.name ?? "",
          values: fields.filter(isInput).map((f) => ({ label: f.label, type: f.type, value: values[f.pdfFieldName] ?? "" })),
          document: doc ? { filename: doc.filename, driveFileId: doc.data ? null : doc.driveFileId, syncError: doc.syncError, signed: doc.variant === "SIGNED" } : null,
          roles: templateSignerRoles(fields).map((key) => ({
            key,
            label: signerRoleLabel(key),
            fields: signerFields(fields, key).map((f) => f.label),
            ...defaults[key],
          })),
          signers: a.signers.map((s) => ({
            ...s,
            openedAt: s.openedAt?.toISOString() ?? null,
            signedAt: s.signedAt?.toISOString() ?? null,
            lastReminderAt: s.lastReminderAt?.toISOString() ?? null,
          })),
          appUsers: appUsers.map((u) => ({ name: u.name || u.email, email: u.email })),
          events: a.events.map((e) => {
            const d = (e.detail ?? {}) as { via?: string; name?: string; email?: string; previous?: string };
            const reassigned = e.type === "reassigned";
            return {
              id: e.id,
              type: e.type === "signed" && d.via === "app" ? "signed_app" : e.type,
              signer: (reassigned ? d.previous : d.name) ?? e.signer?.name ?? d.email ?? "",
              other: reassigned ? (d.name ?? "") : "",
              at: e.createdAt.toISOString(),
            };
          }),
        }}
      />
    </>
  );
}
