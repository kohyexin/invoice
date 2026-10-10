"use client";

import { useRouter } from "next/navigation";
import { CheckCircle2, Clock } from "lucide-react";
import { useI18n } from "@/components/i18n/locale-provider";
import { SignDocument, type SignBox, type SignPayload } from "@/components/signing/sign-document";
import { fieldClass } from "@/components/ui/form-controls";
import { signInApp } from "../../signing-actions";

export function InAppSign({
  agreementId,
  signerId,
  signerName,
  roleLabel,
  boxes,
  others,
}: {
  agreementId: string;
  signerId: string;
  signerName: string;
  roleLabel: string;
  boxes: SignBox[];
  others: { roleLabel: string; name: string; signed: boolean }[];
}) {
  const router = useRouter();
  const { t } = useI18n();

  async function sign(payload: SignPayload) {
    const res = await signInApp(signerId, payload);
    if (!res.ok) return res.error;
    router.push(`/agreements/${agreementId}`);
    router.refresh();
    return null;
  }

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <section className="glass-panel neon-edge rounded-card p-5">
        <p className="text-[13px] text-ink-muted">
          {t("Signing as {0} ({1}). Read the agreement below, then sign at the bottom of the page.", signerName, t(roleLabel))}
        </p>
        {others.length > 0 && (
          <ul className="mt-3 space-y-1.5 text-[13px]">
            {others.map((o, i) => (
              <li key={i} className="flex items-center gap-2 text-ink-muted">
                {o.signed ? <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" /> : <Clock className="h-4 w-4 shrink-0 text-ink-soft" />}
                <span className="min-w-0 truncate">
                  {t(o.roleLabel)}: {o.name}
                </span>
                <span className="ml-auto shrink-0 text-xs text-ink-soft">{o.signed ? t("Signed") : t("Waiting")}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
      <SignDocument
        pdfUrl={`/api/agreements/${agreementId}/pdf?inline`}
        boxes={boxes}
        signerName={signerName}
        panelClass="glass-panel neon-edge rounded-card p-5"
        fieldClass={fieldClass}
        onSubmit={sign}
      />
    </div>
  );
}
