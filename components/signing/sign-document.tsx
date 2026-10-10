"use client";

import { useEffect, useRef, useState } from "react";
import { AlertCircle, Loader2 } from "lucide-react";
import { useI18n } from "@/components/i18n/locale-provider";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { SignatureInput } from "./signature-input";

/* The agreement's pages with the signer's boxes marked "Sign here", followed by
 * the signature, name and consent form. Shared by the emailed signing link and
 * signing inside the app. */

export type SignBox = { page: number; x: number; y: number; width: number; height: number };
export type SignPayload = { signature: string; name: string; agree: boolean };

type PageInfo = { x0: number; y0: number; width: number; height: number };
type PdfDoc = { numPages: number; getPage: (n: number) => Promise<PdfPage> };
type PdfPage = {
  view: number[];
  getViewport: (o: { scale: number }) => { width: number; height: number };
  render: (o: Record<string, unknown>) => { promise: Promise<void>; cancel: () => void };
};

export function SignDocument({
  pdfUrl,
  boxes,
  signerName,
  panelClass,
  fieldClass,
  onSubmit,
}: {
  pdfUrl: string;
  boxes: SignBox[];
  signerName: string;
  /** Card styling of the surrounding page. */
  panelClass: string;
  fieldClass: string;
  /** Resolves to an error message, or null once signed. */
  onSubmit: (payload: SignPayload) => Promise<string | null>;
}) {
  const { t } = useI18n();
  const [doc, setDoc] = useState<PdfDoc | null>(null);
  const [pages, setPages] = useState<PageInfo[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [name, setName] = useState(signerName);
  const [agree, setAgree] = useState(false);
  const [signature, setSignature] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const padRef = useRef<HTMLElement>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(pdfUrl, { cache: "no-store" });
        if (!res.ok) throw new Error();
        const { getDocumentProxy } = await import("unpdf");
        const pdf = (await getDocumentProxy(new Uint8Array(await res.arrayBuffer()))) as unknown as PdfDoc;
        const infos: PageInfo[] = [];
        for (let i = 1; i <= pdf.numPages; i++) {
          const [x0, y0, x1, y1] = (await pdf.getPage(i)).view;
          infos.push({ x0, y0, width: x1 - x0, height: y1 - y0 });
        }
        if (cancelled) return;
        setPages(infos);
        setDoc(pdf);
      } catch {
        if (!cancelled) setLoadError("Couldn't load the agreement. Please refresh the page.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [pdfUrl]);

  const toPad = () => padRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  const valid = !!signature && name.trim().length > 0 && agree;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!valid || !signature) return;
    setError(null);
    setLoading(true);
    const err = await onSubmit({ signature, name: name.trim(), agree }).catch(() => "Something went wrong. Please try again.");
    if (err) {
      setError(err);
      setLoading(false);
    }
  }

  return (
    <>
      <section className="space-y-4">
        {boxes.length > 0 && (
          <Button type="button" variant="secondary" size="sm" onClick={toPad}>
            {t("Go to signing")}
          </Button>
        )}
        {loadError && <ErrorNote>{t(loadError)}</ErrorNote>}
        {!doc && !loadError && (
          <div className={cn(panelClass, "flex h-60 items-center justify-center text-sm text-ink-muted")}>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            {t("Loading agreement…")}
          </div>
        )}
        {doc &&
          pages.map((p, i) => (
            <div key={i} className="relative overflow-hidden rounded-control bg-white shadow-float" style={{ aspectRatio: `${p.width} / ${p.height}` }}>
              <PageCanvas doc={doc} index={i} />
              {boxes
                .filter((b) => b.page === i)
                .map((b, j) => (
                  <button
                    key={j}
                    type="button"
                    onClick={toPad}
                    className="absolute flex items-center justify-center overflow-hidden rounded-[3px] border-2 border-dashed border-amber-500 bg-amber-300/30 text-[10px] font-semibold text-amber-800 sm:text-xs"
                    style={{
                      left: `${((b.x - p.x0) / p.width) * 100}%`,
                      top: `${((p.y0 + p.height - b.y - b.height) / p.height) * 100}%`,
                      width: `${(b.width / p.width) * 100}%`,
                      height: `${(b.height / p.height) * 100}%`,
                    }}
                  >
                    {signature ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={signature} alt="" className="h-full w-full object-contain" />
                    ) : (
                      t("Sign here")
                    )}
                  </button>
                ))}
            </div>
          ))}
      </section>

      <section ref={padRef} className={panelClass}>
        <h2 className="text-lg font-semibold text-ink">{t("Your signature")}</h2>
        <form onSubmit={submit} noValidate className="mt-4 space-y-4">
          {error && <ErrorNote>{t(error)}</ErrorNote>}
          <SignatureInput name={signerName} onChange={setSignature} />
          <div>
            <label htmlFor="sign-name" className="mb-1.5 block text-[13px] font-medium text-ink/80">
              {t("Full name")}
            </label>
            <input id="sign-name" autoComplete="name" value={name} maxLength={120} onChange={(e) => setName(e.target.value)} className={fieldClass} />
          </div>
          <label className="flex items-start gap-2.5 text-sm leading-relaxed text-ink/70">
            <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} className="mt-1 h-4 w-4 shrink-0 accent-brand-500" />
            {t("I have read this agreement and agree that my electronic signature is as binding as a handwritten one.")}
          </label>
          <Button type="submit" size="lg" loading={loading} disabled={!valid} className="w-full">
            {loading ? t("Signing…") : t("Sign agreement")}
          </Button>
        </form>
      </section>
    </>
  );
}

function ErrorNote({ children }: { children: React.ReactNode }) {
  return (
    <div role="alert" className="flex items-center gap-2.5 rounded-control border border-rose-500/30 bg-rose-500/10 px-3.5 py-2.5 text-sm text-rose-600 dark:text-rose-300">
      <AlertCircle className="h-4 w-4 shrink-0" />
      {children}
    </div>
  );
}

function PageCanvas({ doc, index }: { doc: PdfDoc; index: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    let task: { promise: Promise<void>; cancel: () => void } | null = null;
    let cancelled = false;
    (async () => {
      const canvas = ref.current;
      if (!canvas) return;
      const page = await doc.getPage(index + 1);
      if (cancelled) return;
      const base = page.getViewport({ scale: 1 });
      const pixels = Math.min((canvas.parentElement?.clientWidth ?? base.width) * Math.min(window.devicePixelRatio || 1, 2), 2600);
      const viewport = page.getViewport({ scale: pixels / base.width });
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      // 1 draws the filled-in field values; 2 would draw them as editable inputs.
      task = page.render({ canvas, canvasContext: ctx, viewport, annotationMode: 1 });
      await task.promise.catch(() => undefined);
    })();
    return () => {
      cancelled = true;
      task?.cancel();
    };
  }, [doc, index]);
  return <canvas ref={ref} className="pointer-events-none absolute inset-0 h-full w-full" />;
}
