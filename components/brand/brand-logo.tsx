import Image from "next/image";
import { cn } from "@/lib/utils";

/* STAR SAAS wordmark: docs/Logo_white.png with the white behind "STAR" made transparent so it reads on dark backgrounds. */

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
    <Image
      src="/brand/star-saas-logo.png"
      alt="STAR SAAS"
      width={500}
      height={125}
      priority
      draggable={false}
      className={cn("w-auto select-none", lg ? "h-11" : "h-7", className)}
    />
  );
}
