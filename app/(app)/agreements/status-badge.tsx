"use client";

import { useI18n } from "@/components/i18n/locale-provider";
import { Badge } from "@/components/ui/badge";

const LABEL: Record<string, [string, "neutral" | "brand" | "warning" | "success"]> = {
  DRAFT: ["Draft", "neutral"],
  FINALIZED: ["Ready to sign", "brand"],
  SENT: ["Out for signature", "warning"],
  COMPLETED: ["Signed", "success"],
};

export function AgreementStatusBadge({ status }: { status: string }) {
  const { t } = useI18n();
  const [label, tone] = LABEL[status] ?? [status, "neutral"];
  return (
    <Badge tone={tone} dot>
      {t(label)}
    </Badge>
  );
}
