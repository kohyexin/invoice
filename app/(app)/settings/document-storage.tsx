"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, CloudUpload, ExternalLink, FolderArchive, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/components/i18n/locale-provider";
import { formatDate } from "@/lib/utils";
import { disconnectGoogleDrive, syncDocumentsNow } from "./drive-actions";

type Props = {
  configured: boolean;
  connection: { email: string; connectedAt: string; folderUrl: string } | null;
  stats: { total: number; onDrive: number; waiting: number; failing: number; withoutPdf: number; lastError: string | null };
  notice: { kind: "connected" | "error" | "not-configured"; reason?: string } | null;
};

export function DocumentStorage({ configured, connection, stats, notice }: Props) {
  const router = useRouter();
  const { t } = useI18n();
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  const sync = () =>
    start(async () => {
      setMessage(null);
      const res = await syncDocumentsNow();
      if (!res.ok) return setMessage(t(res.error));
      setMessage(t("Uploaded {0}, failed {1}, still waiting {2}.", res.uploaded, res.failed, res.remaining));
      router.refresh();
    });

  const disconnect = () =>
    start(async () => {
      if (!window.confirm(t("Disconnect Google Drive? New PDFs will wait in the app until you connect again."))) return;
      await disconnectGoogleDrive();
      router.refresh();
    });

  return (
    <section className="glass-panel neon-edge mb-6 rounded-card p-5">
      <div className="flex flex-wrap items-start gap-3">
        <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-500/15 text-brand-600 dark:text-brand-300">
          <FolderArchive className="h-[18px] w-[18px]" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-semibold text-ink">{t("PDF archive · Google Drive")}</h2>
          <p className="mt-0.5 max-w-3xl text-[13px] text-ink-muted">
            {t("The PDF of every invoice, kept for audit. Invoices made here are saved when issued and replaced if you edit them (Drive keeps the old version); imported invoices keep the billing system's PDF. Deleting an invoice moves its PDF to Drive's trash. Files are filed as year / month / number.")}
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {connection ? (
            <>
              <a href={connection.folderUrl} target="_blank" rel="noreferrer">
                <Button size="sm" variant="secondary">
                  <ExternalLink className="h-4 w-4" />
                  {t("Open folder")}
                </Button>
              </a>
              <Button size="sm" variant="secondary" onClick={sync} loading={pending}>
                <CloudUpload className="h-4 w-4" />
                {t("Sync now")}
              </Button>
              <Button size="sm" variant="ghost" onClick={disconnect} disabled={pending}>
                {t("Disconnect")}
              </Button>
            </>
          ) : (
            configured && (
              <a href="/api/google/connect">
                <Button size="sm">{t("Connect Google Drive")}</Button>
              </a>
            )
          )}
        </div>
      </div>

      {notice?.kind === "connected" && (
        <p className="mt-3 flex items-center gap-1.5 text-[13px] text-emerald-700 dark:text-emerald-300">
          <CheckCircle2 className="h-4 w-4" />
          {t("Google Drive connected.")}
        </p>
      )}
      {notice?.kind === "error" && (
        <p className="mt-3 rounded-control border border-danger/30 bg-danger/10 px-3 py-2 text-[13px] text-rose-700 dark:text-rose-200">{t(notice.reason ?? "Couldn't connect Google Drive.")}</p>
      )}

      {!configured ? (
        <p className="mt-3 text-[13px] text-amber-700 dark:text-amber-200">
          {t("Not set up yet. Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to the environment, then connect the archive account here. Until then, PDFs are kept in the app.")}
        </p>
      ) : connection ? (
        <p className="mt-3 text-[13px] text-ink-muted">
          {t("Connected as {0} since {1}.", connection.email || "—", formatDate(connection.connectedAt))}
        </p>
      ) : (
        <p className="mt-3 text-[13px] text-ink-muted">{t("Not connected. PDFs are kept in the app until you connect.")}</p>
      )}

      <dl className="mt-4 grid grid-cols-2 gap-3 text-[13px] sm:grid-cols-4">
        {(
          [
            ["PDFs on record", stats.total],
            ["On Google Drive", stats.onDrive],
            ["Waiting to upload", stats.waiting],
            ["Invoices without a PDF", stats.withoutPdf],
          ] as const
        ).map(([label, n]) => (
          <div key={label} className="rounded-control border border-line/70 px-3 py-2">
            <dt className="text-[12px] text-ink-soft">{t(label)}</dt>
            <dd className="tnum text-lg font-semibold text-ink">{n.toLocaleString()}</dd>
          </div>
        ))}
      </dl>
      {stats.failing > 0 && stats.lastError && (
        <p className="mt-3 flex items-start gap-1.5 text-[12px] text-amber-700 dark:text-amber-200">
          <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          {t("{0} PDFs couldn't be uploaded. Last error: {1}", stats.failing, t(stats.lastError))}
        </p>
      )}
      {message && <p className="mt-2 text-[12px] text-ink-muted">{message}</p>}
    </section>
  );
}
