import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Scopeflow — Client approvals, clearly",
  description: "Define deliverables, share a scope, and keep a clear history of client decisions.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}<footer className="site-footer no-print"><span>Scopeflow · Early beta</span><a href="/privacy">Privacy</a><a href="/terms">Terms</a><a href="/support">Support</a></footer></body>
    </html>
  );
}
