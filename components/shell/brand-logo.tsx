import { cn } from "@/lib/utils";

export function BrandLogo({ collapsed = false, className }: { collapsed?: boolean; className?: string }) {
  const mark = (
    <span
      aria-hidden="true"
      className={cn(
        "flex shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-brand-400 to-brand-700 font-bold text-white shadow-glow-brand",
        collapsed ? "h-7 w-7 text-[13px]" : "h-8 w-8 text-[15px]"
      )}
    >
      S
    </span>
  );

  if (collapsed) return <span className={className}>{mark}</span>;

  return (
    <div className={cn("flex min-w-0 items-center gap-2", className)}>
      {mark}
      <div className="min-w-0 leading-none">
        <span className="block truncate font-brand text-[18px] font-extrabold tracking-tight text-ink">
          Star Invoice
        </span>
        <span className="mt-1 block font-mono text-[10px] uppercase tracking-[0.16em] text-ink-soft">
          Billing ledger
        </span>
      </div>
    </div>
  );
}
