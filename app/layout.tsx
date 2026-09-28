import type { Metadata } from "next";
import { Baloo_2 } from "next/font/google";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import "./globals.css";

// Rounded display face for the wordmark (same as Gatehub).
const baloo = Baloo_2({
  subsets: ["latin"],
  weight: ["600", "700", "800"],
  variable: "--font-brand",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Star Invoice",
  description: "Client invoices, payments and billing for SPARK and STAR SAAS.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      className={`dark theme-skin-midnight ${GeistSans.variable} ${GeistMono.variable} ${baloo.variable}`}
    >
      <body>{children}</body>
    </html>
  );
}
