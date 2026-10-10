import type { Metadata } from "next";
import { SignForm } from "../sign-form";

export const metadata: Metadata = { title: "Sign agreement", robots: { index: false, follow: false } };

export default function SignTokenPage({ params }: { params: { token: string } }) {
  return <SignForm token={params.token} />;
}
