"use client";

import { useState } from "react";
import Link from "next/link";
import { AlarmClock, Bell, Inbox, Landmark } from "lucide-react";
import { cn, formatDate, formatMoney } from "@/lib/utils";
import type { ShellAlerts } from "@/lib/shell-alerts";
import { useI18n } from "@/components/i18n/locale-provider";

type Tab = "imports" | "overdue";

/** Header bell + message center dropdown. */
export function NotificationsBell({ alerts }: { alerts: ShellAlerts }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const tabs: { id: Tab; label: string; count: number }[] = [
    ...(alerts.imports ? [{ id: "imports" as const, label: "To review", count: alerts.imports.count + (alerts.statementLines?.count ?? 0) }] : []),
    { id: "overdue", label: "Overdue", count: alerts.overdue.count },
  ];
  const [tab, setTab] = useState<Tab>((tabs.find((x) => x.count > 0) ?? tabs[0]).id);
  const total = tabs.reduce((n, x) => n + x.count, 0);
  const close = () => setOpen(false);

  return (
    <div className="relative">
      <button
        aria-label={t("Message center")}
        title={t("Message center")}
        onClick={() => setOpen((o) => !o)}
        className="relative flex h-8 w-8 items-center justify-center rounded-control text-ink-muted transition-colors hover:bg-overlay/[0.06] hover:text-ink"
      >
        <Bell className="h-4 w-4" />
        {total > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-danger px-1 text-[10px] font-bold leading-none text-white ring-2 ring-surface">
            {total > 9 ? "9+" : total}
          </span>
        )}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-20" onClick={close} />
          <div className="fixed left-3 right-3 top-[4.25rem] z-30 flex max-h-[min(70vh,520px)] flex-col overflow-hidden rounded-card border border-overlay/10 bg-surface/95 shadow-float backdrop-blur-2xl animate-scale-in md:absolute md:left-auto md:right-0 md:top-full md:mt-1.5 md:w-[24rem]">
            <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-2.5">
              <p className="shrink-0 text-[13px] font-semibold text-ink">{t("Message center")}</p>
            </div>

            <div className="flex border-b border-line">
              {tabs.map((mt) => {
                const active = tab === mt.id;
                return (
                  <button
                    key={mt.id}
                    type="button"
                    onClick={() => setTab(mt.id)}
                    className={cn(
                      "relative flex flex-1 items-center justify-center gap-1.5 px-2 py-2.5 text-[12px] font-medium transition-colors",
                      active ? "text-brand-600 dark:text-brand-300" : "text-ink-muted hover:text-ink"
                    )}
                  >
                    {t(mt.label)}
                    {mt.count > 0 && (
                      <span className="rounded-full bg-brand-500/15 px-1.5 py-px text-[10px] font-semibold tabular-nums text-brand-600 dark:text-brand-300">
                        {mt.count}
                      </span>
                    )}
                    {active && (
                      <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-brand shadow-[0_0_8px_0_rgb(var(--brand-500)/0.5)]" />
                    )}
                  </button>
                );
              })}
            </div>

            <div className="min-h-0 flex-1 divide-y divide-line/50 overflow-y-auto">
              {tab === "imports" && alerts.imports ? (
                alerts.imports.items.length === 0 && !alerts.statementLines?.count ? (
                  <Empty text={t("No mailbox imports are waiting for review.")} />
                ) : (
                  <>
                  {!!alerts.statementLines?.count && (
                    <Row
                      href="/cash/import"
                      onNavigate={close}
                      icon={<Landmark className="h-4 w-4" />}
                      title={t("{0} bank statement lines waiting", alerts.statementLines.count)}
                      detail={t("Approve or reject them on Import statement.")}
                    />
                  )}
                  {alerts.imports.items.map((r) => (
                    <Row
                      key={r.id}
                      href="/imports"
                      onNavigate={close}
                      icon={<Inbox className="h-4 w-4" />}
                      title={r.subject || t("(no subject)")}
                      detail={r.reason}
                      meta={formatDate(r.at)}
                    />
                  ))}
                  </>
                )
              ) : alerts.overdue.items.length === 0 ? (
                <Empty text={t("No invoices are past their due date.")} />
              ) : (
                alerts.overdue.items.map((r) => (
                  <Row
                    key={r.id}
                    href={`/invoices/${r.id}`}
                    onNavigate={close}
                    icon={<AlarmClock className="h-4 w-4" />}
                    title={`${r.number} · ${r.client}`}
                    detail={t("Due {0} · USD {1}", formatDate(r.dueDate), formatMoney(r.usd))}
                    tone="warning"
                  />
                ))
              )}
            </div>

            <div className="flex items-center justify-end gap-2 border-t border-line px-3 py-2">
              <Link
                href={tab === "imports" ? "/imports" : "/invoices"}
                onClick={close}
                className="rounded-control px-2.5 py-1 text-[12px] font-medium text-ink-muted transition-colors hover:bg-overlay/[0.04] hover:text-ink"
              >
                {t("View all")}
              </Link>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return <p className="px-4 py-10 text-center text-[13px] text-ink-soft">{text}</p>;
}

function Row({
  href,
  onNavigate,
  icon,
  title,
  detail,
  meta,
  tone = "brand",
}: {
  href: string;
  onNavigate: () => void;
  icon: React.ReactNode;
  title: string;
  detail: string;
  meta?: string;
  tone?: "brand" | "warning";
}) {
  return (
    <Link href={href} onClick={onNavigate} className="flex items-start gap-3 px-4 py-3 transition-colors hover:bg-overlay/[0.04]">
      <span
        className={cn(
          "mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md",
          tone === "warning"
            ? "bg-warning/15 text-amber-600 dark:text-amber-400"
            : "bg-brand-500/15 text-brand-600 dark:text-brand-300"
        )}
      >
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-medium text-ink">{title}</span>
        <span className="line-clamp-2 text-[12px] text-ink-muted">{detail}</span>
      </span>
      {meta && <span className="shrink-0 text-[11px] tabular-nums text-ink-soft">{meta}</span>}
    </Link>
  );
}
