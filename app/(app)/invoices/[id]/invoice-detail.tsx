"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { useCan } from "@/components/shell/user-context";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/components/i18n/locale-provider";
import type { InvoiceStatus } from "@/lib/generated/prisma/enums";
import { setStatus, type EntryInput } from "../actions";
import { EntryForm, type Lookups } from "../entry-form";

const QUICK: { status: InvoiceStatus; label: string }[] = [
  { status: "SENT", label: "Back to sent" },
  { status: "END", label: "End" },
  { status: "LOST", label: "Lost" },
  { status: "WAIVED", label: "Waive" },
];

export function InvoiceDetail({
  id,
  status,
  composed,
  initial,
  lookups,
  afterDelete = "/invoices",
}: {
  id: string;
  status: string;
  composed: boolean;
  initial: EntryInput;
  lookups: Lookups;
  /** Where to go once the entry is deleted: the page the user came from. */
  afterDelete?: string;
}) {
  const router = useRouter();
  const canEdit = useCan("invoices", "EDIT");
  const canPay = useCan("invoicePayments", "EDIT");
  const [pending, start] = useTransition();
  const { t } = useI18n();

  return (
    <section className="glass-panel neon-edge rounded-card p-5">
      <div className="mb-5 flex flex-wrap items-center gap-2">
        <h2 className="mr-auto font-mono text-[11px] uppercase tracking-[0.16em] text-ink-soft">{t("Ledger entry")}</h2>
        {canPay &&
          QUICK.filter((q) => q.status !== status).map((q) => (
            <Button
              key={q.status}
              size="sm"
              variant="ghost"
              disabled={pending}
              onClick={() =>
                start(async () => {
                  await setStatus(id, q.status);
                  router.refresh();
                })
              }
            >
              {t(q.label)}
            </Button>
          ))}
      </div>
      <EntryForm
        key={`${status}-${initial.receivedDate}`}
        id={id}
        initial={initial}
        lookups={lookups}
        readOnly={!canEdit}
        printedLocked={composed}
        onDone={(saved) => (saved ? router.refresh() : router.push(afterDelete))}
      />
    </section>
  );
}
