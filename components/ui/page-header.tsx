"use client";

import Link from "next/link";
import { useI18n } from "@/components/i18n/locale-provider";

export function PageHeader({
  breadcrumb,
  breadcrumbHref,
  title,
  subtitle,
  actions,
}: {
  breadcrumb?: string;
  /** When set, the breadcrumb renders as a link (e.g. back to the Settings hub). */
  breadcrumbHref?: string;
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
}) {
  const { t } = useI18n();
  return (
    <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div>
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
