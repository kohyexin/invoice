import { AppShell } from "@/components/shell/app-shell";
import { UserProvider } from "@/components/shell/user-context";
import { prisma } from "@/lib/db";
import { requirePageRole } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requirePageRole("VIEWER");
  const pendingImports = await prisma.importReview.count({ where: { status: "PENDING" } });
  return (
    <UserProvider user={user}>
      <AppShell badges={{ "/imports": pendingImports }}>{children}</AppShell>
    </UserProvider>
  );
}
