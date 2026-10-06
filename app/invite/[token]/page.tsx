import { InviteForm } from "../invite-form";

export default function InviteTokenPage({ params }: { params: { token: string } }) {
  return <InviteForm token={params.token} />;
}
