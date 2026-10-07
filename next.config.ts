import type { NextConfig } from "next";

// SF-08: browser security headers on every response.
// script-src keeps 'unsafe-inline' because Next's App Router emits inline bootstrap
// scripts and most pages are statically prerendered (a per-request nonce would force
// every page to render dynamically). Framing, plugins, base-uri hijacking and
// third-party script/connect origins are all blocked.
const isProduction = process.env.NODE_ENV === "production";
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isProduction ? "" : " 'unsafe-eval'"}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "frame-ancestors 'none'",
  // The OAuth consent form redirects to the connecting app (https, or loopback for local clients).
  "form-action 'self' https: http://localhost:* http://127.0.0.1:*",
  "manifest-src 'self'",
  "worker-src 'self' blob:",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  ...(isProduction ? [{ key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" }] : []),
];

const nextConfig: NextConfig = {
  agentRules: false,
  poweredByHeader: false,
  experimental: { cpus: 2 },
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      // Review links are bearer secrets: never leak them via Referer.
      { source: "/review/:token*", headers: [{ key: "Referrer-Policy", value: "no-referrer" }] },
    ];
  },
};

export default nextConfig;
