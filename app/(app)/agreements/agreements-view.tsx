"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Download, Plus, Search } from "lucide-react";
import { useI18n } from "@/components/i18n/locale-provider";
import { useCan } from "@/components/shell/user-context";
import { Button } from "@/components/ui/button";
import { DataTable, type Column, type FilterDef } from "@/components/ui/data-table";
import { fieldClass } from "@/components/ui/form-controls";
import { cn, formatDate } from "@/lib/utils";
import { AgreementStatusBadge } from "./status-badge";

type Row = {
  id: string;
  agreementRef: string;
  status: string;
  date: string;
  template: string;
  templateCode: string;
  clientId: string;
  client: string;
  createdBy: string;
  onDrive: boolean;
};

export function AgreementsView({ rows }: { rows: Row[] }) {
  const router = useRouter();
  const canEdit = useCan("agreements", "EDIT");
  const { t } = useI18n();
  const [query, setQuery] = useState("");

  const q = query.trim().toLowerCase();
  const visible = q ? rows.filter((r) => [r.client, r.agreementRef, r.template].some((v) => v.toLowerCase().includes(q))) : rows;
  const templates = Array.from(new Set(rows.map((r) => r.template))).sort();

  const columns: Column<Row>[] = [
    {
      key: "agreementRef",
      header: "Agreement",
      fixed: true,
      accessor: (r) => r.agreementRef,
      render: (r) => (
        <Link href={`/agreements/${r.id}`} className="font-mono text-[13px] text-brand-700 hover:underline dark:text-brand-200">
          {r.agreementRef || r.templateCode}
        </Link>
      ),
    },
    {
      key: "client",
      header: "Client",
      width: "320px",
      accessor: (r) => r.client,
      render: (r) => (
        <Link href={`/clients/${r.clientId}`} className="block truncate text-ink hover:text-brand-700 dark:hover:text-brand-200">
          {r.client}
        </Link>
      ),
    },
    { key: "template", header: "Template", accessor: (r) => r.template, render: (r) => r.template },
    { key: "date", header: "Date", accessor: (r) => r.date, render: (r) => formatDate(r.date) },
    { key: "status", header: "Status", accessor: (r) => r.status, render: (r) => <AgreementStatusBadge status={r.status} /> },
    { key: "createdBy", header: "Created by", defaultHidden: true, accessor: (r) => r.createdBy, render: (r) => r.createdBy || "—" },
    {
      key: "onDrive",
      header: "Google Drive",
      defaultHidden: true,
      accessor: (r) => (r.onDrive ? "Yes" : "No"),
      render: (r) => <span className={r.onDrive ? "text-emerald-600 dark:text-emerald-300" : "text-ink-soft"}>{t(r.onDrive ? "Filed" : "Pending upload")}</span>,
    },
  ];

  const filters: FilterDef<Row>[] = [{ id: "template", label: "Template", options: templates, match: (r, v) => r.template === v }];

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-2.5">
        <div className="relative w-full max-w-sm">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-soft" />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("Search client, agreement no.")} className={cn(fieldClass, "pl-9")} />
        </div>
        {canEdit && (
          <Button className="ml-auto" onClick={() => router.push("/agreements/new")}>
            <Plus className="h-4 w-4" />
            {t("New agreement")}
          </Button>
        )}
      </div>
      <DataTable
        tableId="agreements"
        columns={columns}
        rows={visible}
        filters={filters}
        rowKey={(r) => r.id}
        exportName="agreements"
        defaultPageSize={25}
        rowActions={(r) => (
          <a
            href={`/api/agreements/${r.id}/pdf`}
            aria-label={t("Download PDF")}
            title={t("Download PDF")}
            className="inline-flex h-8 w-8 items-center justify-center rounded-control text-ink-soft hover:bg-overlay/[0.06] hover:text-ink"
          >
            <Download className="h-4 w-4" />
          </a>
        )}
      />
    </>
  );
}
