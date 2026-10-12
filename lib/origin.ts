// Public-origin resolution behind Render's proxy.
//
// `request.url` inside a Next route handler reflects the address the server is bound
// to (`next start --hostname 0.0.0.0` => http://0.0.0.0:PORT), never the public
// hostname. Comparing the browser's Origin header with it made every same-origin
// POST fail with "Origin not allowed." and produced https://0.0.0.0:PORT review links.

const HOST = /^(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*|\[[0-9A-Fa-f:.]+\])(?::\d{1,5})?$/;

function first(value: string | null) {
  return value?.split(',')[0]?.trim() || '';
}

/** APP_URL as an origin, or null when it is unset or not an http(s) URL. */
export function configuredOrigin(env: Record<string, string | undefined> = process.env) {
  const value = env.APP_URL?.trim();
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.origin : null;
  } catch {
    return null;
  }
}

/**
 * The origin the browser actually used, rebuilt from the proxy headers
 * (x-forwarded-proto + x-forwarded-host/host). Header values are validated
 * syntactically; an invalid value falls back to the next source and finally to
 * request.url. Never use this for anything except same-origin comparison and as
 * the fallback public origin when APP_URL is unset.
 */
export function requestOrigin(request: Request) {
  const url = new URL(request.url);
  const proto = first(request.headers.get('x-forwarded-proto')).toLowerCase();
  const protocol = proto === 'https' || proto === 'http' ? proto + ':' : url.protocol;
  for (const candidate of [first(request.headers.get('x-forwarded-host')), first(request.headers.get('host'))]) {
    if (candidate && HOST.test(candidate)) {
      try {
        return new URL(protocol + '//' + candidate).origin;
      } catch {
        // Try the next source.
      }
    }
  }
  return url.origin;
}

let warned = false;
/** Canonical public origin: APP_URL when set, otherwise the forwarded request origin. */
export function appOrigin(request: Request) {
  const configured = configuredOrigin();
  if (!configured) return requestOrigin(request);
  if (!warned && process.env.NODE_ENV === 'production') {
    const seen = requestOrigin(request);
    if (seen !== configured && !/^https?:\/\/(?:0\.0\.0\.0|127\.0\.0\.1|localhost)(?::\d+)?$/.test(seen)) {
      warned = true;
      console.warn(`Scopeflow APP_URL (${configured}) does not match the public origin of incoming requests (${seen}). Set APP_URL to the exact public origin.`);
    }
  }
  return configured;
}

/**
 * CSRF guard for state-changing requests. Requests without an Origin header (server
 * to server, MCP clients, curl) pass, as before. Browser requests pass when their
 * Origin equals the canonical origin (APP_URL) or the origin the request was
 * actually addressed to. A cross-site page cannot make a victim's browser send a
 * foreign Origin together with a matching Host/X-Forwarded-Host, so accepting the
 * request's own origin does not trust arbitrary hosts.
 */
export function safeOrigin(request: Request) {
  const origin = request.headers.get('origin');
  if (!origin) return true;
  if (origin === 'null') return false;
  return origin === appOrigin(request) || origin === requestOrigin(request);
}

/** Absolute public URL for a path on this app. */
export function publicUrl(request: Request, path: string) {
  return new URL(path, appOrigin(request) + '/').href;
}

/**
 * Local path to return to after sign-in. The *normalised* result is validated: the
 * URL parser turns `/.//evil.example` into `//evil.example`, a protocol-relative
 * (external) URL, so the check must run on what is returned, not on the input.
 */
export function safeReturnPath(value: unknown) {
  if (typeof value !== 'string' || value.length > 2000 || !value.startsWith('/') || value.startsWith('//') || /[\\\r\n\t\0]/.test(value)) return '/';
  let url: URL;
  try {
    url = new URL(value, 'https://scopeflow.local');
  } catch {
    return '/';
  }
  if (url.origin !== 'https://scopeflow.local' || url.pathname.startsWith('/auth/') || url.pathname.startsWith('/api/auth/')) return '/';
  const result = url.pathname + url.search + url.hash;
  if (!result.startsWith('/') || result.startsWith('//') || result.includes('\\')) return '/';
  // Final belt-and-braces check: the result must resolve to the same origin.
  if (new URL(result, 'https://scopeflow.local').origin !== 'https://scopeflow.local') return '/';
  return result;
}

// ---------------------------------------------------------------------------------------------
// H3: the client's network address behind trusted proxies.
//
// X-Forwarded-For is a list the client starts and every proxy appends to, so only the entries
// appended by proxies we run behind can be trusted. With SCOPEFLOW_TRUSTED_HOPS=n (Render = 1)
// the client is the n-th entry from the right, never the left-most one (which the caller writes).
// With SCOPEFLOW_TRUSTED_PROXY=cloudflare, `cf-connecting-ip` is used when the request carries a
// `cf-ray` and the peer our proxy saw is a Cloudflare address (so the header cannot be spoofed by
// going around Cloudflare). Without any configuration the headers are ignored.
// ---------------------------------------------------------------------------------------------

type Env = Record<string, string | undefined>;

/** Cloudflare's published ranges (https://www.cloudflare.com/ips/, 2026-10). Override with SCOPEFLOW_CLOUDFLARE_IPS. */
export const CLOUDFLARE_RANGES = [
  '173.245.48.0/20', '103.21.244.0/22', '103.22.200.0/22', '103.31.4.0/22', '141.101.64.0/18', '108.162.192.0/18',
  '190.93.240.0/20', '188.114.96.0/20', '197.234.240.0/22', '198.41.128.0/17', '162.158.0.0/15', '104.16.0.0/13',
  '104.24.0.0/14', '172.64.0.0/13', '131.0.72.0/22',
  '2400:cb00::/32', '2606:4700::/32', '2803:f800::/32', '2405:b500::/32', '2405:8100::/32', '2a06:98c0::/29', '2c0f:f248::/32',
];

/** The address as 4 or 16 bytes, or null when it is not a literal IPv4/IPv6 address. */
export function ipBytes(value: string): number[] | null {
  const v = value.trim();
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(v)) {
    const parts = v.split('.').map(Number);
    return parts.every(n => n <= 255) && v.split('.').every(p => p === '0' || !p.startsWith('0')) ? parts : null;
  }
  if (!/^[0-9A-Fa-f:.]+$/.test(v) || v.length > 45 || !v.includes(':')) return null;
  let head = v, tail: number[] = [];
  const v4 = /(\d{1,3}(?:\.\d{1,3}){3})$/.exec(v);
  if (v4) { const b = ipBytes(v4[1]); if (!b) return null; tail = [(b[0] << 8) | b[1], (b[2] << 8) | b[3]]; head = v.slice(0, -v4[1].length); if (head.endsWith(':') && !head.endsWith('::')) head = head.slice(0, -1); }
  const halves = head.split('::');
  if (halves.length > 2) return null;
  const words = (s: string) => (s ? s.split(':') : []);
  const left = words(halves[0]), right = halves.length === 2 ? words(halves[1]) : [];
  if ([...left, ...right].some(w => !/^[0-9A-Fa-f]{1,4}$/.test(w))) return null;
  const total = left.length + right.length + tail.length;
  if (halves.length === 1 ? total !== 8 : total > 7) return null;
  const groups = [...left.map(w => parseInt(w, 16)), ...Array(8 - total).fill(0), ...right.map(w => parseInt(w, 16)), ...tail];
  if (halves.length === 1 && groups.length !== 8) return null;
  return groups.flatMap(g => [g >> 8, g & 255]);
}

/** Whether `ip` lies in one of the CIDR ranges. */
export function inRanges(ip: string, ranges: string[]) {
  const bytes = ipBytes(ip);
  if (!bytes) return false;
  return ranges.some(range => {
    const [net, bitsText] = range.split('/');
    const base = ipBytes(net);
    const bits = Number(bitsText);
    if (!base || base.length !== bytes.length || !Number.isInteger(bits)) return false;
    for (let i = 0; i < bits; i++) if (((base[i >> 3] >> (7 - (i & 7))) & 1) !== ((bytes[i >> 3] >> (7 - (i & 7))) & 1)) return false;
    return true;
  });
}

/** Normalised key for an address: IPv4 as is, IPv6 by its /64 (one subscriber's prefix). */
export function ipRateKey(ip: string) {
  const bytes = ipBytes(ip);
  if (!bytes) return 'unknown';
  if (bytes.length === 4) return bytes.join('.');
  if (bytes.slice(0, 10).every(b => b === 0) && bytes[10] === 255 && bytes[11] === 255) return bytes.slice(12).join('.'); // IPv4-mapped
  const groups = [0, 2, 4, 6].map(i => ((bytes[i] << 8) | bytes[i + 1]).toString(16));
  return groups.join(':') + '::/64';
}

export function trustedHops(env: Env = process.env) {
  const raw = env.SCOPEFLOW_TRUSTED_HOPS?.trim();
  if (raw === undefined || raw === '') return env.RENDER ? 1 : 0;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 0 && n <= 5 ? n : 0;
}

/**
 * The client address for rate limiting and decision context. Returns 'unknown' when it cannot be
 * established (no trusted proxy configured, or malformed headers), never a caller-chosen value.
 */
export function clientIpFrom(headers: Headers, env: Env = process.env): string {
  const hops = trustedHops(env);
  const chain = (headers.get('x-forwarded-for') ?? '').split(',').map(s => s.trim()).filter(Boolean);
  // The entry appended by the outermost trusted proxy: the peer it saw.
  const peer = hops > 0 && chain.length >= hops ? chain[chain.length - hops] : null;
  const peerIp = peer && ipBytes(peer) ? peer : null;
  if ((env.SCOPEFLOW_TRUSTED_PROXY ?? '').trim().toLowerCase() === 'cloudflare') {
    const cf = headers.get('cf-connecting-ip')?.trim() ?? '';
    const ranges = env.SCOPEFLOW_CLOUDFLARE_IPS ? env.SCOPEFLOW_CLOUDFLARE_IPS.split(',').map(s => s.trim()).filter(Boolean) : CLOUDFLARE_RANGES;
    // Without a trusted hop to vouch for the peer (hops=0, direct to the app behind Cloudflare
    // Tunnel), cf-ray alone is accepted; otherwise the peer must be a Cloudflare edge address.
    const viaCloudflare = !!headers.get('cf-ray') && ipBytes(cf) !== null && (hops === 0 || (peerIp !== null && inRanges(peerIp, ranges)));
    if (viaCloudflare) return cf;
  }
  return peerIp ?? 'unknown';
}

// ---------------------------------------------------------------------------------------------
// H16: one canonical host. Requests that reach the app on another public host name (for example
// scopeflow-qnng.onrender.com) are sent to APP_URL: pages and well-known documents with a 308,
// API and MCP calls with 421 Misdirected Request naming the canonical URL, so MCP clients and
// integrations reconfigure instead of binding tokens to the wrong resource. Health checks,
// webhooks and other machine callbacks are left alone.
// ---------------------------------------------------------------------------------------------

const MACHINE_PATHS = [/^\/api\/health(?:\/|$)/, /^\/api\/readiness(?:\/|$)/, /^\/api\/payments\//, /^\/api\/inbound\//, /^\/api\/whatsapp\//, /^\/api\/mail\/events\//, /^\/api\/heads\//, /^\/api\/payment-accounts\/[^/]+\/callback/];

function hostOf(value: string | null) {
  const host = value?.split(',')[0]?.trim().toLowerCase() ?? '';
  return HOST.test(host) ? host : '';
}
/** Internal or loopback names (health checks, the platform's own probes) are never redirected. */
function internalHost(host: string) {
  const name = host.replace(/:\d+$/, '').replace(/^\[|\]$/g, '');
  return !name.includes('.') || ipBytes(name) !== null || name === 'localhost' || name.endsWith('.internal') || name.endsWith('.local');
}

export type CanonicalDecision = {action: 'next'} | {action: 'redirect'; location: string} | {action: 'misdirected'; canonical: string};

/** What the proxy does with a request for `pathname` + `search` addressed to `host`. */
export function canonicalHostDecision(host: string | null, pathname: string, search: string, env: Env = process.env): CanonicalDecision {
  const canonical = configuredOrigin(env);
  if (!canonical) return {action: 'next'};
  const seen = hostOf(host);
  const want = new URL(canonical).host.toLowerCase();
  if (!seen || seen === want || internalHost(seen)) return {action: 'next'};
  if (MACHINE_PATHS.some(p => p.test(pathname))) return {action: 'next'};
  const location = canonical + pathname + search;
  if (pathname.startsWith('/api/') || pathname === '/mcp' || pathname.startsWith('/mcp/') || pathname.startsWith('/oauth/token') || pathname.startsWith('/oauth/register') || pathname.startsWith('/oauth/revoke')) return {action: 'misdirected', canonical: location};
  return {action: 'redirect', location};
}
