import type { NextConfig } from "next";

// SF-08: browser security headers on every response.
// script-src keeps 'unsafe-inline' because Next's App Router emits inline bootstrap
// scripts and most pages are statically prerendered (a per-request nonce would force
// every page to render dynamically). Framing, plugins, base-uri hijacking and
// third-party script/connect origins are all blocked.
const isProduction = process.env.NODE_ENV === "production";
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isProduction ? "" : " 'unsafe-eval'"} https://checkout.razorpay.com`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https://cdn.razorpay.com",
  "font-src 'self' data:",
  // PR F: Razorpay Checkout (loaded on demand on the review page only when a deposit is due).
  "connect-src 'self' https://api.razorpay.com https://lumberjack.razorpay.com",
  "frame-src https://api.razorpay.com https://checkout.razorpay.com",
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

function buildCpus() {
  const n = Number(process.env.NEXT_BUILD_CPUS);
  return Number.isInteger(n) && n >= 1 && n <= 64 ? n : undefined;
}

const nextConfig: NextConfig = {
  agentRules: false,
  poweredByHeader: false,
  // harfbuzzjs loads its WebAssembly from its own folder at runtime (PDF text shaping), so it is not bundled.
  serverExternalPackages: ["harfbuzzjs"],
  // L10: no hard-coded build parallelism. NEXT_BUILD_CPUS caps the static-generation workers on a
  // small build machine; unset, Next picks its default.
  experimental: {
    ...(buildCpus() ? { cpus: buildCpus() } : {}),
    // H1 (gap audit): proxy.ts runs on every route, and Next buffers each request body for it up to
    // this size (default 10 MB). No route needs more than 1 MB except the eSign callback (a signed
    // PDF), which proxy.ts's matcher skips and which reads its own body within BODY_LIMITS.esign.
    proxyClientMaxBodySize: "1mb",
    // Tree-shake icon, date and chart packages out of the client bundle.
    optimizePackageImports: ["lucide-react", "date-fns", "recharts"],
  },
  // L10: Next's in-build type check alone needs more than the 460 MB heap of a 512 MB instance.
  // `npm run build:capped` skips it; `npm run typecheck` (tsc) gates CI before every build, and
  // main is only built after CI passed.
  ...(process.env.SCOPEFLOW_BUILD_SKIP_TYPECHECK === "1" ? { typescript: { ignoreBuildErrors: true } } : {}),
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      // Review links are bearer secrets: never leak them via Referer.
      { source: "/review/:token*", headers: [{ key: "Referrer-Policy", value: "no-referrer" }] },
      // L15 (gap audit): API responses (token PDFs, JSON) and bearer-token pages are never indexed.
      { source: "/api/:path*", headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }] },
      { source: "/review/:token*", headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }] },
    ];
  },
};

export default nextConfig;
