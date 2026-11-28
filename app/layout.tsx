import type { Metadata, Viewport } from "next";
import { Fraunces, Instrument_Sans } from "next/font/google";
import { Toaster } from "sonner";
import { SiteFooter } from "./site-footer";
import { SESSION_HINT_KEY, themeScript } from "@/lib/theme";
import { configuredOrigin } from "@/lib/origin";
import { SITE_ORIGIN_FALLBACK } from "@/config/site";
import { ThemeProvider } from "./components/slots/theme-switcher";
import { AuthProvider } from "@/src/lib/auth-context";
import AdvisorChat from "./components/advisor-chat";
import "./globals.css";
import "./print.css";

// Two families, nothing else (see the TYPE SCALE in globals.css): Fraunces for display, Instrument Sans for UI.
// Fraunces is loaded with its optical-size axis, so 56px headings get the display cut and 14px italics the
// sturdier text cut (font-optical-sizing:auto). display: swap with next/font's metric-matched fallback, so the
// swap causes no layout shift.
const fraunces = Fraunces({ subsets: ["latin"], weight: "variable", axes: ["opsz"], style: ["normal", "italic"], variable: "--font-fraunces", display: "swap" });
const instrument = Instrument_Sans({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-instrument", display: "swap" });

// M11 (gap audit): a canonical base and a share card for WhatsApp/LinkedIn links. No client data:
// review pages inherit only this generic card.
const SITE_NAME = "ContractLock";
const SITE_TITLE = "ContractLock – Lock Terms, Check Traps & WhatsApp Proof";
const SITE_DESCRIPTION = "Check agreement traps, lock vendor & client terms via WhatsApp, manage multi-event deals, and keep tamper-proof records before you pay with ContractLock.";
const SITE_ORIGIN = configuredOrigin() ?? SITE_ORIGIN_FALLBACK;

const jsonLd = {
  "@context": "https://schema.org",
  "@type": "WebApplication",
  name: SITE_NAME,
  url: SITE_ORIGIN,
  applicationCategory: "BusinessApplication",
  operatingSystem: "All",
  description: SITE_DESCRIPTION,
  featureList: [
    "Agreement & deposit trap checker",
    "WhatsApp one-tap term confirmation links",
    "Multi-event wedding & renovation vendor chains",
    "Tamper-proof SHA-256 & Ed25519 receipts",
    "MSME late-payment interest calculator",
  ],
  offers: {
    "@type": "Offer",
    price: "0",
    priceCurrency: "INR",
  },
};

export const metadata: Metadata = {
  metadataBase: new URL(SITE_ORIGIN),
  title: SITE_TITLE,
  description: SITE_DESCRIPTION,
  applicationName: SITE_NAME,
  keywords: [
    "ContractLock",
    "lock terms before you pay",
    "WhatsApp agreement proof",
    "vendor contract app",
    "agreement trap checker",
    "wedding vendor terms",
    "scope of work confirmation",
    "tamper-proof receipt",
    "MSME late payment interest calculator",
  ],
  alternates: {
    canonical: "/",
  },
  openGraph: {
    type: "website",
    siteName: SITE_NAME,
    url: SITE_ORIGIN,
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
    images: [
      {
        url: "/opengraph-image",
        width: 1200,
        height: 630,
        alt: SITE_TITLE,
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
    images: ["/opengraph-image"],
  },
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export const viewport: Viewport = {
  themeColor: "#0F1D55",
};

// Preview/dev-only compatibility guard: when embedded inside a host iframe bridge that defines window.fetch
// with a getter only (no setter), Next.js dev tooling (e.g. navigation-testing-lock.js) throws a TypeError
// when assigning window.fetch. Preserve the bridge getter while adding a safe delegating setter in dev only.
const devFetchCompatScript =
  process.env.NODE_ENV !== "production"
    ? "try{var _fd=Object.getOwnPropertyDescriptor(window,'fetch');if(_fd&&_fd.configurable&&_fd.get&&!_fd.set){var _fv=_fd.get.call(window);Object.defineProperty(window,'fetch',{configurable:true,enumerable:_fd.enumerable!==false,get:function(){return _fv;},set:function(v){if(typeof v==='function')_fv=v;}});}}catch(e){}"
    : "";

// Before first paint: applies the saved theme/mode (lib/theme.ts, no flash) and marks a returning signed-in
// owner, so the workspace heading shows without a layout shift.
const sessionScript = `${devFetchCompatScript}${themeScript}try{if(localStorage.getItem('${SESSION_HINT_KEY}')==='1')document.documentElement.dataset.auth='in'}catch(e){}`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" data-theme="a" data-mode="dark" data-scheme="dark" className={`${fraunces.variable} ${instrument.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: sessionScript }} />
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      </head>
      <body className="antialiased"><AuthProvider><a className="skip-link" href="#content">Skip to content</a>{children}<SiteFooter /><AdvisorChat /><ThemeProvider /><Toaster position="bottom-center" duration={2600} /></AuthProvider></body>
    </html>
  );
}
