"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Check, ChevronDown, LogOut, Menu, Search, Settings, UserRound } from "lucide-react";
import { cn } from "@/lib/utils";
import { LOCALES } from "@/lib/i18n";
import { can, isManager, roleLabel } from "@/lib/roles";
import type { ShellAlerts } from "@/lib/shell-alerts";
import { ThemeToggle } from "@/components/theme/theme-toggle";
import { LanguageToggle } from "@/components/i18n/language-toggle";
import { useI18n } from "@/components/i18n/locale-provider";
import { CommandPalette } from "@/components/command/command-palette";
import { NotificationsBell } from "@/components/notifications/notifications-bell";
import { initials, signOut, useCurrentUser } from "./user-context";

export function Header({ alerts, onOpenNav }: { alerts: ShellAlerts; onOpenNav: () => void }) {
  const [profileOpen, setProfileOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [shortcutHint, setShortcutHint] = useState("⌘K");
  const { locale, setLocale, t } = useI18n();
  const user = useCurrentUser();

  const menuItems = [
    { label: "My account", icon: UserRound, href: "/account", show: true },
    { label: "Settings", icon: Settings, href: "/settings", show: can(user.role, "settings") || isManager(user.role) },
  ].filter((m) => m.show);

  // Global ⌘K / Ctrl+K opens the command palette.
  useEffect(() => {
    if (!/mac/i.test(navigator.platform)) setShortcutHint("Ctrl K");
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <header className="glass-chrome sticky top-0 z-20 flex h-16 items-center gap-2 border-b border-overlay/10 px-4 sm:gap-4 sm:px-6 xl:px-10">
      {/* Same container as <main> so the search bar lines up with the page
          title and the utility cluster ends at the content's right edge. */}
      <div className="mx-auto flex w-full max-w-[1400px] items-center gap-2 sm:gap-3">
        <button
          onClick={onOpenNav}
          aria-label={t("Open navigation")}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-control text-ink-muted transition-colors hover:bg-overlay/[0.06] hover:text-ink lg:hidden"
        >
          <Menu className="h-[18px] w-[18px]" />
        </button>

        {/* Command-bar pill — opens the ⌘K palette (md+; icon on mobile) */}
        <button
          type="button"
          onClick={() => setPaletteOpen(true)}
          className="group hidden h-9 w-full max-w-sm items-center gap-2.5 rounded-full border border-overlay/10 bg-overlay/[0.04] px-4 text-sm text-ink-soft transition-all hover:border-brand-500/30 hover:bg-overlay/[0.07] hover:text-ink-muted md:flex"
        >
          <Search className="h-4 w-4 shrink-0" />
          <span className="truncate">{t("Search or jump to…")}</span>
          <kbd className="ml-auto rounded border border-line bg-overlay/[0.06] px-1.5 py-0.5 font-mono text-[11px] text-ink-soft">
            {shortcutHint}
          </kbd>
        </button>
        <button
          type="button"
          aria-label={t("Search or jump to…")}
          onClick={() => setPaletteOpen(true)}
          className="flex h-8 w-8 items-center justify-center rounded-control text-ink-muted transition-colors hover:bg-overlay/[0.06] hover:text-ink md:hidden"
        >
          <Search className="h-4 w-4" />
        </button>

        <div className="ml-auto flex items-center gap-0.5">
          {/* Desktop-only utilities — on mobile they live in the profile menu */}
          <div className="hidden items-center gap-0.5 md:flex">
            <ThemeToggle />
            <LanguageToggle />
          </div>

          <NotificationsBell alerts={alerts} />

          <div className="mx-1.5 hidden h-6 w-px bg-line md:block" />

          {/* Profile */}
          <div className="relative">
            <button
              onClick={() => setProfileOpen((o) => !o)}
              aria-label={t("Profile menu")}
              className="flex items-center gap-2 rounded-full py-1 pl-1 pr-2 transition-colors hover:bg-overlay/[0.06]"
            >
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-brand-500 to-brand-700 text-[13px] font-semibold text-white">
                {initials(user.name)}
              </span>
              <ChevronDown className="h-4 w-4 text-ink-soft" />
            </button>

            {profileOpen && (
              <>
                <div className="fixed inset-0 z-20" onClick={() => setProfileOpen(false)} />
                <div className="absolute right-0 top-full z-30 mt-1.5 w-64 overflow-hidden rounded-card border border-overlay/10 bg-surface/90 p-1.5 shadow-float backdrop-blur-2xl animate-scale-in">
                  <div className="border-b border-line px-2.5 py-2.5">
                    <p className="text-sm font-semibold text-ink">{user.name}</p>
                    <p className="truncate text-xs text-ink-muted">{user.email}</p>
                    <p className="mt-1 inline-flex items-center gap-1 rounded-full bg-brand-500/10 px-2 py-0.5 text-[11px] font-medium text-brand-600 dark:bg-brand-500/15 dark:text-brand-300">
                      {roleLabel(t, user.role)}
                    </p>
                  </div>
                  {/* Mobile-only: utilities that leave the header bar below md */}
                  <div className="border-b border-line px-2.5 py-2.5 md:hidden">
                    <div className="flex items-center gap-1.5">
                      <ThemeToggle />
                      {LOCALES.map((l) => (
                        <button
                          key={l.id}
                          onClick={() => setLocale(l.id)}
                          className={cn(
                            "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium transition-colors",
                            locale === l.id
                              ? "bg-brand-500/15 text-brand-600 ring-1 ring-brand-500/30 dark:text-brand-300"
                              : "bg-overlay/[0.05] text-ink-muted hover:bg-overlay/[0.1] hover:text-ink"
                          )}
                        >
                          {locale === l.id && <Check className="h-3 w-3" />}
                          {l.label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="py-1">
                    {menuItems.map(({ label, icon: Icon, href }) => (
                      <Link
                        key={label}
                        href={href}
                        onClick={() => setProfileOpen(false)}
                        className="flex items-center gap-2.5 rounded-control px-2.5 py-2 text-sm text-ink-muted transition-colors hover:bg-overlay/[0.05] hover:text-ink"
                      >
                        <Icon className="h-4 w-4" />
                        {t(label)}
                      </Link>
                    ))}
                  </div>
                  <div className="border-t border-line pt-1">
                    <button
                      type="button"
                      onClick={signOut}
                      className="flex w-full items-center gap-2.5 rounded-control px-2.5 py-2 text-sm text-rose-500 transition-colors hover:bg-rose-500/10 dark:text-rose-400"
                    >
                      <LogOut className="h-4 w-4" />
                      {t("Sign out")}
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
    </header>
  );
}
