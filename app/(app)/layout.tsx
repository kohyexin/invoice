import { AppShell } from "@/components/shell/app-shell";
import { UpdateBanner } from "@/components/shell/update-banner";
import { UserProvider } from "@/components/shell/user-context";
import { requirePage } from "@/lib/session";
import { loadShellAlerts } from "@/lib/shell-alerts";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requirePage();
  const alerts = await loadShellAlerts(user.role);
  return (
    <UserProvider user={user}>
      <AppShell alerts={alerts}>{children}</AppShell>
      <UpdateBanner />
    </UserProvider>
  );
}
