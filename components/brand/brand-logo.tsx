import { cn } from "@/lib/utils";

/* STAR SAAS wordmark (public/logos/star.png), drawn as text so the solid
 * "SAAS" block inverts with the theme instead of vanishing on dark. */

export function BrandMark({ className }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "flex h-7 w-7 shrink-0 items-center justify-center rounded-[5px] bg-ink font-sans text-[15px] font-black leading-none text-canvas",
        className
      )}
    >
      S
    </span>
  );
}

export function BrandLogo({
  collapsed = false,
  size = "md",
  className,
}: {
  collapsed?: boolean;
  size?: "md" | "lg";
  className?: string;
}) {
  if (collapsed) return <BrandMark className={className} />;
  const lg = size === "lg";
  return (
    <span
      role="img"
      aria-label="STAR SAAS"
      className={cn(
        "inline-flex select-none items-stretch font-sans font-black uppercase leading-none tracking-[-0.02em]",
        lg ? "text-[34px]" : "text-[21px]",
        className
      )}
    >
      <span className={cn("text-ink-soft", lg ? "pr-1.5" : "pr-1")}>Star</span>
      <span className={cn("rounded-[3px] bg-ink text-canvas", lg ? "px-2 py-1" : "px-1.5 py-[3px]")}>Saas</span>
    </span>
  );
}
