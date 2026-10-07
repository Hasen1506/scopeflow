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
export function configuredOrigin() {
  const value = process.env.APP_URL?.trim();
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
