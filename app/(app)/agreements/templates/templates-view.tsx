"use client";

import { useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FileUp, Plus } from "lucide-react";
import { useI18n } from "@/components/i18n/locale-provider";
import { Button } from "@/components/ui/button";
import { DataTable, type Column } from "@/components/ui/data-table";
import { Field, StatusPill, fieldClass } from "@/components/ui/form-controls";
import { SidePanel } from "@/components/ui/side-panel";
import { cn, formatDate } from "@/lib/utils";
import { uploadTemplate } from "../actions";

type Row = {
  id: string;
  name: string;
  code: string;
  active: boolean;
  pdfFilename: string;
  fields: number;
  mapped: number;
  agreements: number;
  updatedAt: string;
};

export function TemplatesView({ rows }: { rows: Row[] }) {
  const { t } = useI18n();
  const [uploadOpen, setUploadOpen] = useState(false);

  const columns: Column<Row>[] = [
    {
      key: "name",
      header: "Template",
      fixed: true,
      width: "320px",
      accessor: (r) => r.name,
      render: (r) => (
        <Link href={`/agreements/templates/${r.id}`} className="block truncate font-medium text-ink hover:text-brand-700 dark:hover:text-brand-200">
          {r.name}
        </Link>
      ),
    },
    { key: "code", header: "Code", accessor: (r) => r.code, render: (r) => <span className="font-mono text-[13px]">{r.code}</span> },
    { key: "fields", header: "Fields", align: "right", accessor: (r) => r.fields, render: (r) => r.fields },
    { key: "mapped", header: "Fill the client", align: "right", accessor: (r) => r.mapped, render: (r) => r.mapped },
    { key: "agreements", header: "Agreements", align: "right", accessor: (r) => r.agreements, render: (r) => r.agreements },
    { key: "active", header: "Status", accessor: (r) => (r.active ? 1 : 0), render: (r) => <StatusPill active={r.active} /> },
    { key: "pdfFilename", header: "PDF", defaultHidden: true, accessor: (r) => r.pdfFilename, render: (r) => <span className="text-ink-muted">{r.pdfFilename || "—"}</span> },
    { key: "updatedAt", header: "Updated", accessor: (r) => r.updatedAt, render: (r) => formatDate(r.updatedAt) },
  ];

  return (
    <>
      <div className="mb-4 flex justify-end">
        <Button onClick={() => setUploadOpen(true)}>
          <Plus className="h-4 w-4" />
          {t("Upload template")}
        </Button>
      </div>
      <DataTable tableId="agreement-templates" columns={columns} rows={rows} rowKey={(r) => r.id} exportName="agreement-templates" />
      <UploadTemplate open={uploadOpen} onClose={() => setUploadOpen(false)} />
    </>
  );
}

function UploadTemplate({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const { t } = useI18n();
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function close() {
    setFile(null);
    setName("");
    setCode("");
    setError(null);
    onClose();
  }

  function submit() {
    if (!file) return;
    setError(null);
    const form = new FormData();
    form.set("file", file);
    form.set("name", name);
    form.set("code", code);
    start(async () => {
      const res = await uploadTemplate(form);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      router.push(`/agreements/templates/${res.id}`);
    });
  }

  return (
    <SidePanel
      open={open}
      onClose={close}
      title="Upload template"
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={close}>
            {t("Cancel")}
          </Button>
          <Button size="sm" onClick={submit} disabled={!file || !name.trim() || !code.trim()} loading={pending}>
            {t("Upload and set up fields")}
          </Button>
        </>
      }
    >
      <p className="text-[13px] text-ink-muted">
        {t("Upload the blank agreement, then place the fields on its pages. Fillable fields already in the PDF are picked up. Each field becomes a question on the New agreement form.")}
      </p>
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        className="mt-4 flex w-full flex-col items-center gap-2 rounded-card border border-dashed border-overlay/20 px-4 py-8 text-center transition-colors hover:border-brand-400/60 hover:bg-brand-500/[0.05]"
      >
        <FileUp className="h-6 w-6 text-brand-600 dark:text-brand-300" />
        <span className="text-sm font-medium text-ink">{file?.name || t("Choose a PDF file")}</span>
      </button>
      <input
        ref={inputRef}
        type="file"
        accept="application/pdf,.pdf"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (!f) return;
          setFile(f);
          if (!name) setName(f.name.replace(/\.pdf$/i, ""));
        }}
      />
      <div className="mt-5 space-y-4">
        <Field label="Name *">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder={t("e.g. PCI Agreement")} className={fieldClass} />
        </Field>
        <Field label="Code *" hint="Short id shown in lists and file names when an agreement has no number, e.g. PCI or PAAS.">
          <input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} className={cn(fieldClass, "font-mono uppercase")} />
        </Field>
      </div>
      {error && <p className="mt-4 rounded-control border border-danger/30 bg-danger/10 px-3 py-2 text-[13px] text-rose-700 dark:text-rose-200">{t(error)}</p>}
    </SidePanel>
  );
}
