import { PageHeader } from "@/components/ui/page-header";
import { prisma } from "@/lib/db";
import { StatementImportView } from "./import-view";

export default async function StatementImportPage() {
  const categories = await prisma.cashCategory.findMany({
    where: { active: true },
    orderBy: [{ sortOrder: "asc" }, { nameZh: "asc" }],
    select: { id: true, nameZh: true, nameEn: true, kind: true },
  });
  return (
    <>
      <PageHeader
        title="Import statement"
        subtitle="Upload monthly bank statement PDFs. Each month is checked against the cash book; interest and anything missing are added once you confirm."
      />
      <StatementImportView categories={categories} />
    </>
  );
}
