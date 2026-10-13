import {NextResponse, type NextRequest} from 'next/server';
import {canonicalHostDecision} from '@/lib/origin';

const NO_STORE = {'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff'};

export function proxy(request: NextRequest) {
  const {pathname, search} = request.nextUrl;
  // H16: one canonical host (APP_URL). Pages and well-known documents on another public host get a
  // 308 to the same path on APP_URL; API, MCP and OAuth endpoint calls get 421 naming the canonical
  // URL, so MCP clients reconfigure instead of binding tokens to the wrong resource.
  const host = request.headers.get('host');
  const decision = canonicalHostDecision(host, pathname, search);
  if (decision.action === 'redirect') return NextResponse.redirect(decision.location, {status: 308, headers: NO_STORE});
  if (decision.action === 'misdirected') {
    return NextResponse.json({error: 'This address is not Scopeflow\'s canonical host. Use ' + new URL(decision.canonical).origin + ' instead.', code: 'misdirected_request', canonical_url: decision.canonical}, {status: 421, headers: {...NO_STORE, Link: `<${decision.canonical}>; rel="canonical"`}});
  }
  // Malformed percent-encoding in a dynamic segment (e.g. /api/scopes/%E0 or /review/%E0)
  // makes Next.js throw a URIError while decoding route params, which surfaced as a bare
  // "500 Internal Server Error". It is bad client input: answer 400 before routing.
  if (pathname.startsWith('/api/') || pathname.startsWith('/review/')) {
    try {
      decodeURIComponent(pathname);
    } catch {
      return pathname.startsWith('/api/')
        ? NextResponse.json({error: 'Malformed URL encoding.'}, {status: 400, headers: NO_STORE})
        : new NextResponse('Bad request: malformed URL encoding.', {status: 400, headers: NO_STORE});
    }
  }
  return NextResponse.next();
}

// Every route except Next's own static assets (the canonical-host check applies to pages too).
export const config = {matcher: ['/((?!_next/static|_next/image|favicon\\.svg|art/).*)']};
