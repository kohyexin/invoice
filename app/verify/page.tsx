import { redirect } from "next/navigation";
import { getPendingUser, maskEmail } from "@/lib/mfa";
import { getCurrentUser } from "@/lib/session";
import { VerifyForm } from "./verify-form";

export const dynamic = "force-dynamic";

export default async function VerifyPage() {
  if (await getCurrentUser()) redirect("/dashboard");
  const user = await getPendingUser();
  if (!user) redirect("/login");
  return <VerifyForm needsSetup={!user.totpSecret} maskedEmail={maskEmail(user.email)} />;
}
