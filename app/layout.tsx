import type { Metadata, Viewport } from "next";
import { Fraunces, Instrument_Sans } from "next/font/google";
import { Toaster } from "sonner";
import { SiteFooter } from "./site-footer";
import { SESSION_HINT_KEY, themeScript } from "@/lib/theme";
import { configuredOrigin } from "@/lib/origin";
import { SITE_ORIGIN_FALLBACK } from "@/config/site";
import { ThemeProvider } from "./components/slots/theme-switcher";
import "./globals.css";

// Two families, nothing else (see the TYPE SCALE in globals.css): Fraunces for display, Instrument Sans for UI.
// Fraunces is loaded with its optical-size axis, so 56px headings get the display cut and 14px italics the
// sturdier text cut (font-optical-sizing:auto). display: swap with next/font's metric-matched fallback, so the
// swap causes no layout shift.
const fraunces = Fraunces({ subsets: ["latin"], weight: "variable", axes: ["opsz"], style: ["normal", "italic"], variable: "--font-fraunces", display: "swap" });
const instrument = Instrument_Sans({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-instrument", display: "swap" });

// M11 (gap audit): a canonical base and a share card for WhatsApp/LinkedIn links. No client data:
// review pages inherit only this generic card.
const SITE_TITLE = "TermsLock — Lock clear terms before you pay";
const SITE_DESCRIPTION = "Check agreement traps, confirm terms over WhatsApp, and keep tamper-proof records — even when they won’t sign a formal contract.";
export const metadata: Metadata = {
  metadataBase: new URL(configuredOrigin() ?? SITE_ORIGIN_FALLBACK),
  title: SITE_TITLE,
  description: SITE_DESCRIPTION,
  openGraph: { type: "website", siteName: "TermsLock", title: SITE_TITLE, description: SITE_DESCRIPTION },
  twitter: { card: "summary", title: SITE_TITLE, description: SITE_DESCRIPTION },
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export const viewport: Viewport = {
  themeColor: [{ media: "(prefers-color-scheme: light)", color: "#F4EEE1" }, { media: "(prefers-color-scheme: dark)", color: "#11152A" }],
};

// Before first paint: applies the saved theme/mode (lib/theme.ts, no flash) and marks a returning signed-in
// owner, so the workspace heading shows without a layout shift.
const sessionScript = `${themeScript}try{if(localStorage.getItem('${SESSION_HINT_KEY}')==='1')document.documentElement.dataset.auth='in'}catch(e){}`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" data-theme="b" data-mode="system" data-scheme="light" className={`${fraunces.variable} ${instrument.variable}`} suppressHydrationWarning>
      <head><script dangerouslySetInnerHTML={{ __html: sessionScript }} /></head>
      <body className="antialiased"><a className="skip-link" href="#content">Skip to content</a>{children}<SiteFooter /><ThemeProvider /><Toaster position="bottom-center" duration={2600} /></body>
    </html>
  );
}
