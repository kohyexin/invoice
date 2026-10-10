import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { LoginForm } from "./login-form";

export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams }: { searchParams: { invited?: string; idle?: string } }) {
  if (await getCurrentUser()) redirect("/dashboard");
  const invited = searchParams.invited;
  return (
    <LoginForm
      invited={typeof invited === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(invited) ? invited : undefined}
      idle={searchParams.idle === "1"}
    />
  );
}
