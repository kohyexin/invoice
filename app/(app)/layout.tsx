import { AppShell } from "@/components/shell/app-shell";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const pendingImports = await prisma.importReview.count({ where: { status: "PENDING" } });
  return <AppShell badges={{ "/imports": pendingImports }}>{children}</AppShell>;
}
