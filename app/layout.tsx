import type { Metadata } from "next";
import { Baloo_2 } from "next/font/google";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import "./globals.css";
import { ThemeProvider } from "@/components/theme/theme-provider";
import { LocaleProvider } from "@/components/i18n/locale-provider";
import { getLocale } from "@/lib/i18n-server";

// Rounded display face (same as Gatehub).
const baloo = Baloo_2({
  subsets: ["latin"],
  weight: ["600", "700", "800"],
  variable: "--font-brand",
  display: "swap",
});

export const metadata: Metadata = {
  title: "STAR SAAS Back Office",
  description: "Clients, invoices, cash, agreements and e-signing for SPARK and STAR SAAS.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = getLocale();
  return (
    <html
      lang={locale}
      className={`${GeistSans.variable} ${GeistMono.variable} ${baloo.variable}`}
      suppressHydrationWarning
    >
      <body className="theme-skin-midnight">
        <ThemeProvider attribute="class" defaultTheme="dark" enableSystem={false} disableTransitionOnChange>
          <LocaleProvider initialLocale={locale}>{children}</LocaleProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
