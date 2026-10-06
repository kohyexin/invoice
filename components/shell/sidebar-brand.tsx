"use client";

import Link from "next/link";
import { cn } from "@/lib/utils";
import { BrandLogo, BrandMark } from "@/components/brand/brand-logo";
import { useI18n } from "@/components/i18n/locale-provider";

export const PRODUCT_NAME = "Invoice & Cash";

/** Sidebar identity: STAR SAAS logo and the product name, linking home. */
export function SidebarBrand({ collapsed, onNavigate }: { collapsed?: boolean; onNavigate?: () => void }) {
  const { t } = useI18n();
  return (
    <Link
      href="/dashboard"
      onClick={onNavigate}
      title={collapsed ? `STAR SAAS · ${t(PRODUCT_NAME)}` : undefined}
      className={cn("flex items-center rounded-control px-1.5 py-1.5 transition-colors hover:bg-overlay/[0.04]", collapsed && "justify-center px-0")}
    >
      {collapsed ? (
        <BrandMark className="h-8 w-8" />
      ) : (
        <span className="flex flex-col items-start gap-1">
          <BrandLogo className="h-7" />
          <span className="pl-0.5 text-[11px] font-semibold uppercase tracking-[0.18em] text-ink-soft">{t(PRODUCT_NAME)}</span>
        </span>
      )}
    </Link>
  );
}
