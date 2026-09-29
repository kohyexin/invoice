import { ResetPasswordForm } from "../reset-forms";

export default function ResetTokenPage({ params }: { params: { token: string } }) {
  return <ResetPasswordForm token={params.token} />;
}
