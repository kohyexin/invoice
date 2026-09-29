import { AppShell } from "@/components/shell/app-shell";
import { UserProvider } from "@/components/shell/user-context";
import { requirePageRole } from "@/lib/session";
import { loadShellAlerts } from "@/lib/shell-alerts";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requirePageRole("VIEWER");
  const alerts = await loadShellAlerts(user.role);
  return (
    <UserProvider user={user}>
      <AppShell alerts={alerts}>{children}</AppShell>
    </UserProvider>
  );
}
