import { PageHeader } from "@/components/ui/page-header";
import { requirePageRole } from "@/lib/session";
import { AccountView } from "./account-view";

export default async function AccountPage() {
  const user = await requirePageRole("VIEWER");
  return (
    <>
      <PageHeader title="My account" subtitle="Your name, sign-in email and password." />
      <AccountView name={user.name} email={user.email} role={user.role} />
    </>
  );
}
