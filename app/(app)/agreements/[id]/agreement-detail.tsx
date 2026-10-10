"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Download, ExternalLink, TriangleAlert } from "lucide-react";
import { useI18n } from "@/components/i18n/locale-provider";
import { useCan } from "@/components/shell/user-context";
import { Button } from "@/components/ui/button";
import type { FieldType } from "@/lib/agreements/fields";
import { cn, formatDate } from "@/lib/utils";
import { agreementDeletePlan, deleteAgreement, type AgreementDeletePlan } from "../actions";
import { AgreementStatusBadge } from "../status-badge";
import { SigningPanel, type AppUser, type SigningEvent, type SigningRole, type SigningSigner } from "./signing-panel";

type Detail = {
  id: string;
  status: string;
  date: string;
  sentAt: string | null;
  completedAt: string | null;
  template: string;
  client: { id: string; name: string };
  createdBy: string;
  values: { label: string; type: FieldType; value: string }[];
  document: { filename: string; driveFileId: string | null; syncError: string; signed: boolean } | null;
  roles: SigningRole[];
  signers: SigningSigner[];
  events: SigningEvent[];
  appUsers: AppUser[];
};

function shown(type: FieldType, value: string) {
  if (type === "checkbox") return value === "true" ? "Yes" : "No";
  if (type === "date" && value) return formatDate(value);
  return value || "—";
}

export function AgreementDetail({ agreement: a }: { agreement: Detail }) {
  const router = useRouter();
  const { t } = useI18n();
  const canEdit = useCan("agreements", "EDIT");
  const canDeleteClient = useCan("clients", "EDIT");
  const [plan, setPlan] = useState<AgreementDeletePlan | null>(null);
  const [alsoClient, setAlsoClient] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const pdfUrl = `/api/agreements/${a.id}/pdf`;

  const linked = plan ? Object.values(plan.links).some((n) => n > 0) : true;
  const offerClient = Boolean(plan?.createdClient && !linked && canDeleteClient);

  function askDelete() {
    setError(null);
    start(async () => {
      const res = await agreementDeletePlan(a.id);
      if (!res.ok) return setError(res.error);
      setPlan(res.plan);
      setAlsoClient(Boolean(res.plan.createdClient && !Object.values(res.plan.links).some((n) => n > 0) && canDeleteClient));
    });
  }

  function remove() {
    start(async () => {
      const res = await deleteAgreement(a.id, { deleteClient: offerClient && alsoClient });
      if (!res.ok) {
        setPlan(null);
        return setError(res.error);
      }
      router.push(res.clientDeleted ? "/clients" : "/agreements");
    });
  }

  return (
    <div className="grid gap-6 xl:grid-cols-[380px_minmax(0,1fr)]">
      <aside className="space-y-4">
        <section className="glass-panel neon-edge rounded-card p-5">
          <div className="flex items-center justify-between gap-3">
            <h2 className="font-mono text-[11px] uppercase tracking-[0.16em] text-ink-soft">{t("Agreement")}</h2>
            <AgreementStatusBadge status={a.status} />
          </div>
          <dl className="mt-4 space-y-2.5 text-[13px]">
            <div className="flex justify-between gap-3">
              <dt className="text-ink-soft">{t("Client")}</dt>
              <dd className="text-right">
                <Link href={`/clients/${a.client.id}`} className="text-brand-700 hover:underline dark:text-brand-200">
                  {a.client.name}
                </Link>
              </dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-ink-soft">{t("Template")}</dt>
              <dd className="text-right text-ink">{a.template}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-ink-soft">{t("Date")}</dt>
              <dd className="text-right text-ink">{formatDate(a.date)}</dd>
            </div>
            {a.createdBy && (
              <div className="flex justify-between gap-3">
                <dt className="text-ink-soft">{t("Created by")}</dt>
                <dd className="text-right text-ink">{a.createdBy}</dd>
              </div>
            )}
            {a.sentAt && (
              <div className="flex justify-between gap-3">
                <dt className="text-ink-soft">{t("Sent for signature")}</dt>
                <dd className="text-right text-ink">{formatDate(a.sentAt)}</dd>
              </div>
            )}
            {a.completedAt && (
              <div className="flex justify-between gap-3">
                <dt className="text-ink-soft">{t("Signed by everyone")}</dt>
                <dd className="text-right text-ink">{formatDate(a.completedAt)}</dd>
              </div>
            )}
          </dl>
          <div className="mt-5 flex flex-wrap gap-2">
            <a href={pdfUrl}>
              <Button size="sm">
                <Download className="h-4 w-4" />
                {t("Download PDF")}
              </Button>
            </a>
            {a.document?.driveFileId && (
              <a href={`https://drive.google.com/file/d/${a.document.driveFileId}/view`} target="_blank" rel="noreferrer">
                <Button size="sm" variant="secondary">
                  <ExternalLink className="h-4 w-4" />
                  {t("Open in Google Drive")}
                </Button>
              </a>
            )}
          </div>
          {a.document && !a.document.driveFileId && (
            <p className="mt-3 flex items-start gap-1.5 text-[12px] text-ink-soft">
              {a.document.syncError && <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600" />}
              {a.document.syncError ? t("Not on Google Drive yet: {0}", t(a.document.syncError)) : t("Waiting to upload to Google Drive.")}
            </p>
          )}
        </section>

        <SigningPanel agreementId={a.id} status={a.status} roles={a.roles} signers={a.signers} events={a.events} appUsers={a.appUsers} />

        <section className="glass-panel neon-edge rounded-card p-5">
          <h2 className="font-mono text-[11px] uppercase tracking-[0.16em] text-ink-soft">{t("Details entered")}</h2>
          <dl className="mt-4 space-y-2.5 text-[13px]">
            {a.values.map((v, i) => (
              <div key={i}>
                <dt className="text-ink-soft">{v.label}</dt>
                <dd className="whitespace-pre-wrap break-words text-ink">{t(shown(v.type, v.value))}</dd>
              </div>
            ))}
          </dl>
        </section>

        {canEdit && (
          <div className="space-y-2">
            {error && <p className="rounded-control border border-danger/30 bg-danger/10 px-3 py-2 text-[13px] text-rose-700 dark:text-rose-200">{t(error)}</p>}
            {!plan ? (
              <Button variant="ghost" onClick={askDelete} loading={pending}>
                {t("Delete agreement")}
              </Button>
            ) : (
              <div className="glass-panel rounded-card border border-danger/30 p-4 text-[13px]">
                <p className="font-medium text-ink">{t("Delete this agreement?")}</p>
                <ul className="mt-2 list-disc space-y-1 pl-4 text-ink-muted">
                  <li>{t("The PDF moves to Google Drive's trash.")}</li>
                  {plan.number &&
                    (plan.number.remove ? (
                      <li>{t("Agreement no. {0} is taken off {1}.", plan.number.ref, plan.client.name)}</li>
                    ) : (
                      <li>
                        {plan.number.invoices > 0
                          ? t("Agreement no. {0} stays on {1}: {2} invoice(s) use it.", plan.number.ref, plan.client.name, plan.number.invoices)
                          : t("Agreement no. {0} stays on {1}: another agreement uses it.", plan.number.ref, plan.client.name)}
                      </li>
                    ))}
                  <li>{t("The client's other details and fees stay as they are.")}</li>
                </ul>

                {plan.createdClient && (
                  <div className="mt-3 rounded-control bg-overlay/[0.04] p-3">
                    <p className="text-ink">{t("This agreement created the client {0}.", plan.client.name)}</p>
                    <ul className="mt-1.5 space-y-0.5 text-[12px] text-ink-muted">
                      {(
                        [
                          ["Invoices", plan.links.invoices],
                          ["Other agreements", plan.links.agreements],
                          ["Credit entries", plan.links.credits],
                          ["Import reviews", plan.links.importReviews],
                        ] as const
                      ).map(([label, n]) => (
                        <li key={label} className="flex justify-between gap-3">
                          <span>{t(label)}</span>
                          <span className={cn("tnum", n > 0 ? "font-medium text-amber-700 dark:text-amber-300" : "text-ink-soft")}>{n}</span>
                        </li>
                      ))}
                    </ul>
                    {offerClient ? (
                      <label className="mt-2.5 flex items-center gap-2 text-ink">
                        <input
                          type="checkbox"
                          checked={alsoClient}
                          onChange={(e) => setAlsoClient(e.target.checked)}
                          className="h-4 w-4 rounded border-overlay/20 bg-overlay/5 text-brand focus:ring-brand/40"
                        />
                        {t("Also delete the client {0}", plan.client.name)}
                      </label>
                    ) : (
                      <p className="mt-2 text-[12px] text-ink-soft">
                        {linked ? t("The client is kept because other records are linked to it.") : t("You don't have permission to delete clients.")}
                      </p>
                    )}
                  </div>
                )}

                <div className="mt-3 flex gap-2">
                  <Button variant="danger" size="sm" onClick={remove} loading={pending}>
                    {t(offerClient && alsoClient ? "Delete agreement and client" : "Delete agreement")}
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => setPlan(null)} disabled={pending}>
                    {t("Cancel")}
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}
      </aside>

      <section className="glass-panel neon-edge min-h-[70vh] rounded-card p-3">
        <iframe
          key={`${a.status}-${a.signers.filter((s) => s.status === "SIGNED").length}`}
          src={`${pdfUrl}?inline#view=FitH`} title={t("Agreement PDF")} className="h-full min-h-[70vh] w-full rounded-control bg-white" />
      </section>
    </div>
  );
}
