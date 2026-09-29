"use client";

import { useState } from "react";
import Link from "next/link";
import { Building2, Check, ChevronsUpDown, LogOut, UserRound } from "lucide-react";
import { cn } from "@/lib/utils";
import { ROLE_LABEL } from "@/lib/roles";
import { useI18n } from "@/components/i18n/locale-provider";
import { signOut, useCurrentUser } from "./user-context";

export const WORKSPACE_NAME = "STAR SAAS Limited";

/** Sidebar account block: the workspace and the role you act as. */
export function AccountSwitcher({ collapsed, dropUp }: { collapsed?: boolean; dropUp?: boolean }) {
  const [open, setOpen] = useState(false);
  const { t } = useI18n();
  const user = useCurrentUser();

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        title={collapsed ? `${WORKSPACE_NAME} · ${t(ROLE_LABEL[user.role])}` : undefined}
        className={cn(
          "flex w-full items-center gap-2.5 rounded-control border border-line bg-overlay/[0.03] p-2 text-left transition-colors hover:bg-overlay/[0.06]",
          collapsed && "justify-center"
        )}
      >
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-brand text-white">
          <Building2 className="h-4 w-4" />
        </span>
        {!collapsed && (
          <>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] font-semibold text-ink">{WORKSPACE_NAME}</span>
              <span className="block truncate text-[11px] text-ink-muted">{t(ROLE_LABEL[user.role])}</span>
            </span>
            <ChevronsUpDown className="h-4 w-4 shrink-0 text-ink-soft" />
          </>
        )}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-20" onClick={() => setOpen(false)} />
          <div
            className={cn(
              "absolute left-0 z-30 w-[300px] max-w-[calc(100vw-2rem)] overflow-hidden rounded-card border border-overlay/10 bg-surface/90 p-1.5 shadow-float backdrop-blur-2xl animate-scale-in",
              dropUp ? "bottom-full mb-1.5" : "top-full mt-1.5"
            )}
          >
            <p className="px-2.5 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-soft">
              {t("Workspace")}
            </p>
            <div className="flex items-center gap-2 rounded-control bg-brand/[0.08] px-1.5 py-1.5">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-brand text-white">
                <Building2 className="h-4 w-4" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-semibold text-ink">{WORKSPACE_NAME}</span>
                <span className="block truncate text-[10.5px] text-ink-soft">
                  {user.name} · {t(ROLE_LABEL[user.role])}
                </span>
              </span>
              <Check className="h-4 w-4 shrink-0 text-brand" />
            </div>
            <div className="mx-1.5 my-1 h-px bg-overlay/10" />
            <Link
              href="/account"
              onClick={() => setOpen(false)}
              className="flex w-full items-center gap-2 rounded-control px-2.5 py-2 text-left text-[13px] font-medium text-ink-muted transition-colors hover:bg-overlay/[0.06] hover:text-ink"
            >
              <UserRound className="h-4 w-4 shrink-0 text-brand" />
              {t("My account")}
            </Link>
            <button
              type="button"
              onClick={signOut}
              className="flex w-full items-center gap-2 rounded-control px-2.5 py-2 text-left text-[13px] font-medium text-rose-500 transition-colors hover:bg-rose-500/10 dark:text-rose-400"
            >
              <LogOut className="h-4 w-4 shrink-0" />
              {t("Sign out")}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
