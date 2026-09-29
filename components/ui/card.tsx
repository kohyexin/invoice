"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { useI18n } from "@/components/i18n/locale-provider";

export function Card({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "glass-panel neon-edge rounded-card",
        className
      )}
      {...props}
    />
  );
}

export function CardHeader({
  title,
  subtitle,
  action,
  className,
}: {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  const { t } = useI18n();
  return (
    <div className={cn("flex items-start justify-between gap-4 px-5 pt-5", className)}>
      <div>
        <h3 className="text-[15px] font-semibold text-ink">{typeof title === "string" ? t(title) : title}</h3>
        {subtitle && (
          <p className="mt-0.5 text-[13px] text-ink-muted">{typeof subtitle === "string" ? t(subtitle) : subtitle}</p>
        )}
      </div>
      {action}
    </div>
  );
}
