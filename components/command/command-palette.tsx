"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import {
  Building2,
  CornerDownLeft,
  FilePlus2,
  FileText,
  Languages,
  LogOut,
  Moon,
  Search,
  Sun,
  UserPlus,
  UserRound,
  type LucideIcon,
} from "lucide-react";
import { cn, formatCurrency } from "@/lib/utils";
import { navGroups } from "@/lib/nav";
import { hasRole } from "@/lib/roles";
import { useI18n } from "@/components/i18n/locale-provider";
import { signOut, useCurrentUser } from "@/components/shell/user-context";

/* ⌘K command palette: navigate, run actions, and search clients and
   invoices from one centered overlay. */

type Item = {
  id: string;
  icon: LucideIcon;
  label: string;
  detail?: string;
  /** Extra match terms (e.g. the English label so EN search works in zh). */
  keywords?: string;
  perform: () => void;
};

type Group = { label: string; items: Item[] };

type SearchResult = {
  clients: { id: string; name: string; detail: string }[];
  invoices: { id: string; number: string; client: string; amount: number; currency: string; status: string }[];
};

const EMPTY: SearchResult = { clients: [], invoices: [] };

export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { locale, setLocale, t } = useI18n();
  const router = useRouter();
  const { resolvedTheme, setTheme } = useTheme();
  const user = useCurrentUser();
  const canEdit = hasRole(user.role, "STAFF");
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [results, setResults] = useState<SearchResult>(EMPTY);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) {
      setQuery("");
      setActive(0);
      setResults(EMPTY);
    }
  }, [open]);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setResults(EMPTY);
      return;
    }
    const ctrl = new AbortController();
    const timer = setTimeout(() => {
      fetch(`/api/search?q=${encodeURIComponent(q)}`, { signal: ctrl.signal })
        .then((r) => (r.ok ? r.json() : EMPTY))
        .then(setResults)
        .catch(() => {});
    }, 180);
    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
  }, [query]);

  const groups = useMemo<Group[]>(() => {
    const q = query.trim().toLowerCase();
    const matches = (...terms: (string | undefined)[]) => q === "" || terms.some((s) => s?.toLowerCase().includes(q));
    const go = (href: string) => () => router.push(href);

    const navigation: Item[] = navGroups
      .flatMap((g) => g.items)
      .filter((i) => !i.minRole || hasRole(user.role, i.minRole))
      .filter((i) => matches(t(i.label), i.label))
      .map((i) => ({ id: `nav-${i.href}`, icon: i.icon, label: t(i.label), perform: go(i.href) }));

    const isDark = resolvedTheme === "dark";
    const actions: Item[] = [
      ...(canEdit
        ? [
            { id: "new-invoice", icon: FilePlus2, label: t("New invoice"), keywords: "new invoice create", perform: go("/invoices/new") },
            { id: "new-client", icon: UserPlus, label: t("New client"), keywords: "new client add", perform: go("/clients/new") },
          ]
        : []),
      {
        id: "theme",
        icon: isDark ? Sun : Moon,
        label: t("Toggle theme"),
        detail: isDark ? t("Light") : t("Dark"),
        keywords: "toggle theme dark light mode",
        perform: () => setTheme(isDark ? "light" : "dark"),
      },
      {
        id: "lang",
        icon: Languages,
        label: t("Switch language"),
        detail: locale === "en" ? "简体中文" : "English",
        keywords: "switch language english chinese 中文",
        perform: () => setLocale(locale === "en" ? "zh-CN" : "en"),
      },
      { id: "account", icon: UserRound, label: t("My account"), keywords: "my account profile password two-factor", perform: go("/account") },
      { id: "signout", icon: LogOut, label: t("Sign out"), keywords: "sign out logout", perform: () => void signOut() },
    ].filter((a) => matches(a.label, a.keywords, a.detail));

    const invoices: Item[] = results.invoices.map((i) => ({
      id: `inv-${i.id}`,
      icon: FileText,
      label: `${i.number} · ${i.client}`,
      detail: `${formatCurrency(i.amount, i.currency)} · ${t(i.status)}`,
      perform: go(`/invoices/${i.id}`),
    }));

    const clients: Item[] = results.clients.map((c) => ({
      id: `client-${c.id}`,
      icon: Building2,
      label: c.name,
      detail: c.detail || undefined,
      perform: go(`/clients/${c.id}`),
    }));

    return [
      { label: t("Navigation"), items: navigation },
      { label: t("Actions"), items: actions },
      { label: t("Invoices"), items: invoices },
      { label: t("Clients"), items: clients },
    ].filter((g) => g.items.length > 0);
  }, [query, results, locale, resolvedTheme, canEdit, user.role, router, setTheme, setLocale, t]);

  const flat = useMemo(() => groups.flatMap((g) => g.items), [groups]);

  useEffect(() => setActive(0), [query]);

  // Keep the active row visible while arrowing through the list.
  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActive((i) => Math.min(i + 1, flat.length - 1));
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setActive((i) => Math.max(i - 1, 0));
      }
      if (e.key === "Enter" && flat[active]) {
        e.preventDefault();
        run(flat[active]);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, flat, active, onClose]);

  if (!open) return null;

  function run(item: Item) {
    onClose();
    item.perform();
  }

  let index = -1;

  // Portal to <body>: the header is a sticky stacking context, so rendering
  // inline would let page content paint above the overlay.
  return createPortal(
    <div className="fixed inset-0 z-[65]">
      <div className="absolute inset-0 bg-canvas/55 backdrop-blur-sm animate-fade-in" onClick={onClose} aria-hidden="true" />

      <div
        role="dialog"
        aria-modal="true"
        aria-label={t("Command palette")}
        className="absolute left-1/2 top-[16vh] w-full max-w-xl -translate-x-1/2 px-4"
      >
        <div className="neon-edge overflow-hidden rounded-card border border-overlay/10 bg-surface/95 shadow-float backdrop-blur-2xl animate-scale-in">
          <div className="flex items-center gap-3 border-b border-line px-4">
            <Search className="h-4 w-4 shrink-0 text-ink-soft" />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("Search or jump to…")}
              className="h-12 w-full bg-transparent text-[15px] text-ink placeholder:text-ink-soft focus:outline-none"
            />
            <kbd className="rounded border border-line bg-overlay/[0.06] px-1.5 py-0.5 font-mono text-[11px] text-ink-soft">Esc</kbd>
          </div>

          <div ref={listRef} className="max-h-[46vh] overflow-y-auto p-2">
            {flat.length === 0 && <p className="px-3 py-8 text-center text-sm text-ink-muted">{t("No results found.")}</p>}
            {groups.map((group) => (
              <div key={group.label} className="mb-1">
                <p className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-ink-soft">{group.label}</p>
                {group.items.map((item) => {
                  index += 1;
                  const i = index;
                  const selected = i === active;
                  const Icon = item.icon;
                  return (
                    <button
                      key={item.id}
                      data-index={i}
                      type="button"
                      onClick={() => run(item)}
                      onMouseMove={() => setActive(i)}
                      className={cn(
                        "flex w-full items-center gap-3 rounded-control px-3 py-2.5 text-left transition-colors",
                        selected ? "bg-brand-500/10" : "hover:bg-overlay/[0.05]"
                      )}
                    >
                      <span
                        className={cn(
                          "flex h-7 w-7 shrink-0 items-center justify-center rounded-md",
                          selected ? "bg-brand-500/15 text-brand-600 dark:text-brand-300" : "bg-overlay/[0.06] text-ink-muted"
                        )}
                      >
                        <Icon className="h-4 w-4" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className={cn("block truncate text-sm font-medium", selected ? "text-ink" : "text-ink-muted")}>
                          {item.label}
                        </span>
                        {item.detail && <span className="block truncate text-xs text-ink-soft">{item.detail}</span>}
                      </span>
                      {selected && <CornerDownLeft className="h-3.5 w-3.5 shrink-0 text-ink-soft" />}
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
