"use client";

import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { useI18n } from "@/components/i18n/locale-provider";

export function PageHeader({
  breadcrumb,
  breadcrumbHref,
  back,
  title,
  subtitle,
  actions,
}: {
  breadcrumb?: string;
  /** When set, the breadcrumb renders as a link (e.g. back to the Settings hub). */
  breadcrumbHref?: string;
  /** The page the user came from, shown as "← label" above the title. */
  back?: { label: string; href: string };
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
}) {
  const { t } = useI18n();
  return (
    <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div>
        {back && (
          <Link
            href={back.href}
            className="mb-2 inline-flex max-w-full items-center gap-1.5 rounded-control border border-overlay/10 bg-overlay/[0.04] px-2.5 py-1 text-[13px] font-medium text-ink-muted transition-colors hover:bg-overlay/[0.08] hover:text-ink"
          >
            <ArrowLeft className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">{t("Back to {0}", t(back.label))}</span>
          </Link>
        )}
        {back && breadcrumb && <br />}
        {breadcrumb &&
          (breadcrumbHref ? (
            <Link
              href={breadcrumbHref}
              className="mb-1 inline-block text-sm font-medium text-brand-600 transition-colors hover:text-brand-700 hover:underline dark:text-brand-300 dark:hover:text-brand-200"
            >
              {t(breadcrumb)}
            </Link>
          ) : (
            <p className="mb-1 text-sm font-medium text-ink-muted">{t(breadcrumb)}</p>
          ))}
        <h1 className="text-[28px] font-bold leading-tight tracking-tight text-ink sm:text-3xl">{t(title)}</h1>
        {subtitle && <p className="mt-1 text-sm text-ink-muted">{t(subtitle)}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2.5">{actions}</div>}
    </div>
  );
}
