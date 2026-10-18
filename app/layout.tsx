import type { Metadata, Viewport } from "next";
import Script from "next/script";
import { Fraunces, Instrument_Sans } from "next/font/google";
import { LazyToaster } from "./toaster";
import { SiteFooter } from "./site-footer";
import { SESSION_HINT_KEY, themeScript } from "@/lib/theme";
import { configuredOrigin } from "@/lib/origin";
import { SITE_ORIGIN_FALLBACK } from "@/config/site";
import ThemeSwitcher, { ThemeProvider } from "./components/slots/theme-switcher";
import "./globals.css";

// Two families, nothing else (see the TYPE SCALE in globals.css): Fraunces for display, Instrument Sans for UI.
// Static cuts, not the full variable file. display: optional so a slow first visit paints the heading
// in next/font's metric-matched fallback instead of holding LCP until the file arrives.
// Headings are weight 400 (see --fw-1). Optional display paints the metric-matched fallback on a slow first visit.
// Instrument is not preloaded: the hero heading is Fraunces, and a second family on the critical path delays it.
const fraunces = Fraunces({ subsets: ["latin"], weight: ["400"], style: ["normal", "italic"], variable: "--font-fraunces", display: "optional", preload: false });
const instrument = Instrument_Sans({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-instrument", display: "optional", preload: false });

// M11 (gap audit): a canonical base and a share card for WhatsApp/LinkedIn links. No client data:
// review pages inherit only this generic card.
const SITE_TITLE = "Scopeflow — Client approvals, clearly";
const SITE_DESCRIPTION = "Define deliverables, share a scope, and keep a clear history of client decisions.";
export const metadata: Metadata = {
  metadataBase: new URL(configuredOrigin() ?? SITE_ORIGIN_FALLBACK),
  title: SITE_TITLE,
  description: SITE_DESCRIPTION,
  openGraph: { type: "website", siteName: "Scopeflow", title: SITE_TITLE, description: SITE_DESCRIPTION },
  twitter: { card: "summary", title: SITE_TITLE, description: SITE_DESCRIPTION },
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export const viewport: Viewport = {
  themeColor: [{ media: "(prefers-color-scheme: light)", color: "#F4EEE1" }, { media: "(prefers-color-scheme: dark)", color: "#11152A" }],
};

// Before first paint: applies the saved appearance (lib/theme.ts) and marks a returning signed-in
// owner, so the workspace shows instead of the marketing page. next/script beforeInteractive injects
// this into the initial HTML. The attributes are not set on <html> in React, or a refresh would
// reset them and flash the wrong theme and the landing page.
const sessionScript = `${themeScript}try{if(localStorage.getItem('${SESSION_HINT_KEY}')==='1')document.documentElement.dataset.auth='in'}catch(e){}`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="antialiased">
        <Script id="scopeflow-boot" strategy="beforeInteractive">{sessionScript}</Script>
        {/* Instrument Sans starts after the first paint, so its files are not on the LCP path. */}
        <Script id="scopeflow-ui-font" strategy="afterInteractive">{`requestAnimationFrame(function(){setTimeout(function(){document.documentElement.classList.add(${JSON.stringify(fraunces.variable)},${JSON.stringify(instrument.variable)},"fonts-ready")},0)})`}</Script>
        <a className="skip-link" href="#content">Skip to content</a>
        <aside className="side-rail" aria-label="Appearance"><ThemeSwitcher /></aside>
        {children}
        <SiteFooter />
        <ThemeProvider />
        <LazyToaster />
      </body>
    </html>
  );
}
