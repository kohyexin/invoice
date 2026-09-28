"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
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
  initial,
  lookups,
}: {
  id: string;
  status: string;
  initial: EntryInput;
  lookups: Lookups;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();

  return (
    <section className="glass-panel neon-edge rounded-card p-5">
      <div className="mb-5 flex flex-wrap items-center gap-2">
        <h2 className="mr-auto font-mono text-[11px] uppercase tracking-[0.16em] text-ink-soft">Ledger entry</h2>
        {QUICK.filter((q) => q.status !== status).map((q) => (
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
            {q.label}
          </Button>
        ))}
      </div>
      <EntryForm
        key={`${status}-${initial.receivedDate}`}
        id={id}
        initial={initial}
        lookups={lookups}
        onDone={(saved) => (saved ? router.refresh() : router.push("/invoices"))}
      />
    </section>
  );
}
