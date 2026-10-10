"use client";

import { useEffect, useRef, useState } from "react";
import { Allura, Caveat, Dancing_Script, Great_Vibes } from "next/font/google";
import { Eraser, PenLine, Type } from "lucide-react";
import { useI18n } from "@/components/i18n/locale-provider";
import { cn } from "@/lib/utils";

/* A signature, either drawn with a finger or mouse, or typed and shown in a
 * handwriting font (like DocuSign's "select style"). Either way it is handed
 * on as a PNG data URL, cropped to the ink. */

const dancing = Dancing_Script({ subsets: ["latin"], weight: "600", display: "swap" });
const vibes = Great_Vibes({ subsets: ["latin"], weight: "400", display: "swap" });
const caveat = Caveat({ subsets: ["latin"], weight: "600", display: "swap" });
const allura = Allura({ subsets: ["latin"], weight: "400", display: "swap" });
const STYLES = [dancing, vibes, allura, caveat];

const INK = "#111827";

export function SignatureInput({ name, onChange }: { name: string; onChange: (png: string | null) => void }) {
  const { t } = useI18n();
  const [mode, setMode] = useState<"draw" | "type">("draw");
  const [typed, setTyped] = useState(name);
  const [style, setStyle] = useState(0);
  const drawn = useRef<string | null>(null);

  useEffect(() => {
    if (mode === "draw") return onChange(drawn.current);
    const text = typed.trim();
    if (!text) return onChange(null);
    let cancelled = false;
    renderTyped(text, STYLES[style].style.fontFamily).then((png) => !cancelled && onChange(png));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, typed, style]);

  return (
    <div>
      <div className="mb-3 inline-flex rounded-control border border-overlay/10 bg-overlay/[0.04] p-0.5">
        {(
          [
            ["draw", PenLine, "Draw"],
            ["type", Type, "Type name"],
          ] as const
        ).map(([m, Icon, label]) => (
          <button
            key={m}
            type="button"
            onClick={() => setMode(m)}
            className={cn(
              "inline-flex h-8 items-center gap-1.5 rounded-[6px] px-3 text-[13px] font-medium",
              mode === m ? "bg-brand-500/15 text-brand-700 dark:text-brand-200" : "text-ink-muted hover:text-ink"
            )}
          >
            <Icon className="h-3.5 w-3.5" />
            {t(label)}
          </button>
        ))}
      </div>

      {mode === "draw" ? (
        <DrawPad
          onChange={(png) => {
            drawn.current = png;
            onChange(png);
          }}
          initial={drawn.current}
        />
      ) : (
        <div className="space-y-3">
          <input
            value={typed}
            maxLength={60}
            onChange={(e) => setTyped(e.target.value)}
            placeholder={t("Type your name")}
            aria-label={t("Type your name")}
            className="h-10 w-full rounded-control border border-overlay/10 bg-overlay/5 px-3 text-sm text-ink placeholder:text-ink-soft focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-500/30"
          />
          <div className="grid gap-2 sm:grid-cols-2">
            {STYLES.map((f, i) => (
              <button
                key={i}
                type="button"
                onClick={() => setStyle(i)}
                className={cn(
                  "flex h-20 items-center justify-center overflow-hidden rounded-control border bg-white px-3 text-slate-900",
                  style === i ? "border-brand-500 ring-2 ring-brand-500/40" : "border-overlay/15 hover:border-brand-400"
                )}
              >
                <span className={cn(f.className, "truncate text-[32px] leading-none")}>{typed.trim() || t("Your name")}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/** The typed name drawn in the chosen font, big enough to stay sharp on the PDF. */
async function renderTyped(text: string, fontFamily: string) {
  const size = 120;
  const font = `${size}px ${fontFamily}`;
  await document.fonts.load(font, text).catch(() => undefined);
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.font = font;
  const width = Math.ceil(ctx.measureText(text).width) + size;
  canvas.width = Math.min(width, 4000);
  canvas.height = Math.round(size * 1.8);
  ctx.font = font;
  ctx.fillStyle = INK;
  ctx.textBaseline = "middle";
  ctx.fillText(text, size / 2, canvas.height / 2);
  return trimmed(canvas);
}

function DrawPad({ onChange, initial }: { onChange: (png: string | null) => void; initial: string | null }) {
  const { t } = useI18n();
  const ref = useRef<HTMLCanvasElement>(null);
  const last = useRef<{ x: number; y: number } | null>(null);
  const [empty, setEmpty] = useState(!initial);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = canvas.clientWidth * ratio;
    canvas.height = canvas.clientHeight * ratio;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.scale(ratio, ratio);
    ctx.lineWidth = 2.2;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = ctx.fillStyle = INK;
    if (initial) {
      const img = new Image();
      img.onload = () => {
        const scale = Math.min((canvas.clientWidth - 24) / img.width, (canvas.clientHeight - 24) / img.height, 1);
        const w = img.width * scale;
        const h = img.height * scale;
        ctx.drawImage(img, (canvas.clientWidth - w) / 2, (canvas.clientHeight - h) / 2, w, h);
      };
      img.src = initial;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function point(e: React.PointerEvent<HTMLCanvasElement>) {
    const r = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  function down(e: React.PointerEvent<HTMLCanvasElement>) {
    e.currentTarget.setPointerCapture(e.pointerId);
    last.current = point(e);
    const ctx = e.currentTarget.getContext("2d");
    ctx?.beginPath();
    ctx?.arc(last.current.x, last.current.y, 1, 0, Math.PI * 2);
    ctx?.fill();
  }

  function move(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!last.current) return;
    const ctx = e.currentTarget.getContext("2d");
    if (!ctx) return;
    const p = point(e);
    ctx.beginPath();
    ctx.moveTo(last.current.x, last.current.y);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    last.current = p;
  }

  function up(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!last.current) return;
    last.current = null;
    setEmpty(false);
    onChange(trimmed(e.currentTarget));
  }

  function clear() {
    const canvas = ref.current;
    canvas?.getContext("2d")?.clearRect(0, 0, canvas.width, canvas.height);
    setEmpty(true);
    onChange(null);
  }

  return (
    <div>
      <div className="relative">
        <canvas
          ref={ref}
          onPointerDown={down}
          onPointerMove={move}
          onPointerUp={up}
          onPointerCancel={up}
          className="h-44 w-full cursor-crosshair touch-none rounded-control border border-overlay/15 bg-white sm:h-52"
        />
        {empty && (
          <span className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm text-slate-400">{t("Draw your signature here")}</span>
        )}
        <span className="pointer-events-none absolute inset-x-6 bottom-9 border-b border-slate-300" />
      </div>
      <button
        type="button"
        onClick={clear}
        disabled={empty}
        className={cn("mt-2 inline-flex items-center gap-1.5 text-sm text-ink-muted hover:text-ink", empty && "pointer-events-none opacity-40")}
      >
        <Eraser className="h-4 w-4" />
        {t("Clear")}
      </button>
    </div>
  );
}

/** The drawing cropped to its ink, so it fills the signature box on the PDF. */
function trimmed(canvas: HTMLCanvasElement) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas.toDataURL("image/png");
  const { width, height } = canvas;
  const alpha = ctx.getImageData(0, 0, width, height).data;
  let [minX, minY, maxX, maxY] = [width, height, -1, -1];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (alpha[(y * width + x) * 4 + 3] === 0) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  if (maxX < 0) return canvas.toDataURL("image/png");
  const pad = 6;
  const [sx, sy] = [Math.max(0, minX - pad), Math.max(0, minY - pad)];
  const [w, h] = [Math.min(width, maxX + pad + 1) - sx, Math.min(height, maxY + pad + 1) - sy];
  const out = document.createElement("canvas");
  out.width = w;
  out.height = h;
  out.getContext("2d")?.drawImage(canvas, sx, sy, w, h, 0, 0, w, h);
  return out.toDataURL("image/png");
}
