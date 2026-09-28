"use client";

import { useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import Papa from "papaparse";
import { FileUp, Plus, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DataTable, type Column, type FilterDef } from "@/components/ui/data-table";
import { SidePanel } from "@/components/ui/side-panel";
import { toClientDraft } from "@/lib/client-import";
import { fieldClass } from "@/components/ui/form-controls";
import { cn, formatDate, formatMoney } from "@/lib/utils";
import { importJotformRows } from "./actions";

type Row = {
  id: string;
  name: string;
  alias: string;
  agreementNo: string;
  country: string;
  owner: string;
  invoices: number;
  unpaid: number;
  submittedAt: string | null;
};

export function ClientsView({ rows }: { rows: Row[] }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [importOpen, setImportOpen] = useState(false);

  const q = query.trim().toLowerCase();
  const visible = q
    ? rows.filter((r) => [r.name, r.alias, r.agreementNo, r.country].some((v) => v.toLowerCase().includes(q)))
    : rows;

  const owners = Array.from(new Set(rows.map((r) => r.owner).filter(Boolean))).sort();

  const columns: Column<Row>[] = [
    {
      key: "name",
      header: "Client",
      fixed: true,
      width: "360px",
      accessor: (r) => r.name,
      render: (r) => (
        <Link href={`/clients/${r.id}`} className="block truncate font-medium text-ink hover:text-brand-200">
          {r.name}
        </Link>
      ),
    },
    { key: "alias", header: "Alias", accessor: (r) => r.alias, render: (r) => <span className="font-mono text-[13px] text-ink-muted">{r.alias || "—"}</span> },
    { key: "agreementNo", header: "Agreement", accessor: (r) => r.agreementNo, render: (r) => <span className="font-mono text-[13px]">{r.agreementNo || "—"}</span> },
    { key: "country", header: "Country", accessor: (r) => r.country, render: (r) => r.country || "—" },
    { key: "owner", header: "Owner", accessor: (r) => r.owner, render: (r) => r.owner || "—" },
    { key: "invoices", header: "Invoices", align: "right", accessor: (r) => r.invoices, render: (r) => r.invoices },
    {
      key: "unpaid",
      header: "Unpaid (USD)",
      align: "right",
      accessor: (r) => r.unpaid,
      render: (r) => (r.unpaid > 0 ? <span className="text-amber-300">{formatMoney(r.unpaid)}</span> : <span className="text-ink-soft">—</span>),
    },
    { key: "submittedAt", header: "Form submitted", defaultHidden: true, accessor: (r) => r.submittedAt ?? "", render: (r) => formatDate(r.submittedAt) },
  ];

  const filters: FilterDef<Row>[] = [
    { id: "owner", label: "Owner", options: owners, match: (r, v) => r.owner === v },
    { id: "unpaid", label: "Balance", options: ["Has unpaid", "Fully paid"], match: (r, v) => (v === "Has unpaid" ? r.unpaid > 0 : r.unpaid === 0) },
  ];

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-2.5">
        <div className="relative w-full max-w-sm">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-soft" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search name, alias, agreement"
            className={cn(fieldClass, "pl-9")}
          />
        </div>
        <div className="ml-auto flex gap-2">
          <Button variant="secondary" onClick={() => setImportOpen(true)}>
            <FileUp className="h-4 w-4" />
            Import Jotform CSV
          </Button>
          <Button onClick={() => router.push("/clients/new")}>
            <Plus className="h-4 w-4" />
            Add client
          </Button>
        </div>
      </div>

      <DataTable tableId="clients" columns={columns} rows={visible} filters={filters} rowKey={(r) => r.id} exportName="clients" defaultPageSize={25} />

      <JotformImport open={importOpen} onClose={() => setImportOpen(false)} existing={new Set(rows.map((r) => r.name))} />
    </>
  );
}

function JotformImport({ open, onClose, existing }: { open: boolean; onClose: () => void; existing: Set<string> }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [rows, setRows] = useState<Record<string, string>[]>([]);
  const [fileName, setFileName] = useState("");
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const drafts = rows.map((r) => toClientDraft(r)).filter((d): d is NonNullable<typeof d> => d !== null);
  const newCount = drafts.filter((d) => !existing.has(d.name)).length;

  function reset() {
    setRows([]);
    setFileName("");
    setResult(null);
    setError(null);
    if (inputRef.current) inputRef.current.value = "";
  }

  function pick(file: File) {
    reset();
    setFileName(file.name);
    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: true,
      complete: (res) => setRows(res.data),
      error: (err) => setError(err.message),
    });
  }

  function run() {
    start(async () => {
      const res = await importJotformRows(rows);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setResult(`${res.created} added, ${res.updated} updated${res.skipped ? `, ${res.skipped} skipped (no client name)` : ""}.`);
      setRows([]);
      router.refresh();
    });
  }

  return (
    <SidePanel
      open={open}
      onClose={() => {
        reset();
        onClose();
      }}
      title="Import Jotform CSV"
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={() => { reset(); onClose(); }}>
            Close
          </Button>
          <Button size="sm" onClick={run} disabled={drafts.length === 0} loading={pending}>
            Import {drafts.length || ""} clients
          </Button>
        </>
      }
    >
      <p className="text-[13px] text-ink-muted">
        Clients are matched by client name. Existing clients get their address, agreement and fee schedule refreshed from
        the form. Alias, owner, transfer name and notes stay as they are.
      </p>

      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        className="mt-4 flex w-full flex-col items-center gap-2 rounded-card border border-dashed border-overlay/20 px-4 py-8 text-center transition-colors hover:border-brand-400/60 hover:bg-brand-500/[0.05]"
      >
        <FileUp className="h-6 w-6 text-brand-300" />
        <span className="text-sm font-medium text-ink">{fileName || "Choose a CSV file"}</span>
        <span className="text-[12px] text-ink-soft">Jotform export with a CLIENT NAME column</span>
      </button>
      <input ref={inputRef} type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => e.target.files?.[0] && pick(e.target.files[0])} />

      {error && <p className="mt-4 rounded-control border border-danger/30 bg-danger/10 px-3 py-2 text-[13px] text-rose-200">{error}</p>}
      {result && <p className="mt-4 rounded-control border border-success/30 bg-success/10 px-3 py-2 text-[13px] text-emerald-200">{result}</p>}

      {drafts.length > 0 && (
        <div className="mt-5">
          <p className="mb-2 text-[13px] text-ink-muted">
            {drafts.length} rows: <span className="text-ink">{newCount} new</span>, {drafts.length - newCount} existing.
          </p>
          <div className="max-h-[50vh] overflow-y-auto rounded-card border border-line/70">
            <table className="w-full text-[13px]">
              <thead className="sticky top-0 bg-surface">
                <tr className="border-b border-line text-left text-[11px] uppercase tracking-wider text-ink-soft">
                  <th className="px-3 py-2">Client</th>
                  <th className="px-3 py-2">Agreement</th>
                  <th className="px-3 py-2 text-right">Fees</th>
                </tr>
              </thead>
              <tbody>
                {drafts.map((d, i) => (
                  <tr key={i} className="border-b border-line/60 last:border-0">
                    <td className="px-3 py-2">
                      <span className="text-ink">{d.name}</span>
                      {!existing.has(d.name) && <span className="ml-2 rounded-full bg-brand-500/15 px-1.5 text-[11px] text-brand-200">new</span>}
                    </td>
                    <td className="px-3 py-2 font-mono text-ink-muted">{d.agreementNo || "—"}</td>
                    <td className="px-3 py-2 text-right text-ink-muted">{Object.keys(d.fees).length}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </SidePanel>
  );
}
