import { PageHeader } from "@/components/ui/page-header";
import { prisma } from "@/lib/db";
import { requirePage } from "@/lib/session";
import { AccountView } from "./account-view";

export default async function AccountPage() {
  const user = await requirePage();
  const { totpEnabledAt } = await prisma.user.findUniqueOrThrow({ where: { id: user.id }, select: { totpEnabledAt: true } });
  return (
    <>
      <PageHeader title="My account" subtitle="Your name, sign-in email, password and two-factor authentication." />
      <AccountView name={user.name} email={user.email} role={user.role} totpEnabledAt={totpEnabledAt?.toISOString() ?? null} />
    </>
  );
}
