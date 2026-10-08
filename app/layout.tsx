import type { Metadata, Viewport } from "next";
import { EB_Garamond, Fraunces } from "next/font/google";
import { Toaster } from "sonner";
import { SiteFooter } from "./site-footer";
import { SESSION_HINT_KEY, THEME_KEY } from "@/lib/theme";
import "./globals.css";

// Display serifs only (UI text uses the system sans stack, so it costs nothing to load).
// Theme B's Fraunces (400 roman + italic, ~43 KB) is preloaded; Theme A's Garamond loads only when A is chosen.
// display: swap with next/font's metric-matched fallback, so the swap causes no layout shift.
const fraunces = Fraunces({ subsets: ["latin"], weight: ["400"], style: ["normal", "italic"], variable: "--font-fraunces", display: "swap" });
const garamond = EB_Garamond({ subsets: ["latin"], weight: ["400", "500"], style: ["normal", "italic"], variable: "--font-garamond", display: "swap", preload: false });

export const metadata: Metadata = {
  title: "Scopeflow — Client approvals, clearly",
  description: "Define deliverables, share a scope, and keep a clear history of client decisions.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export const viewport: Viewport = {
  themeColor: [{ color: "#F4EEE1" }],
};

// Applies the saved theme before first paint, so there is no flash and no layout shift.
const themeScript = `try{var d=document.documentElement,t=localStorage.getItem('${THEME_KEY}');d.dataset.theme=t==='a'?'a':'b';if(localStorage.getItem('${SESSION_HINT_KEY}')==='1')d.dataset.auth='in'}catch(e){}`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" data-theme="b" className={`${fraunces.variable} ${garamond.variable}`} suppressHydrationWarning>
      <head><script dangerouslySetInnerHTML={{ __html: themeScript }} /></head>
      <body className="antialiased"><a className="skip-link" href="#main">Skip to content</a>{children}<SiteFooter /><Toaster position="bottom-center" duration={2600} /></body>
    </html>
  );
}
