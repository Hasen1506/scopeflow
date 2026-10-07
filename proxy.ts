import {NextResponse, type NextRequest} from 'next/server';

// Malformed percent-encoding in a dynamic segment (e.g. /api/scopes/%E0 or /review/%E0)
// makes Next.js throw a URIError while decoding route params, which surfaced as a bare
// "500 Internal Server Error". It is bad client input: answer 400 before routing.
export function proxy(request: NextRequest) {
  try {
    decodeURIComponent(request.nextUrl.pathname);
  } catch {
    const headers = {'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff'};
    return request.nextUrl.pathname.startsWith('/api/')
      ? NextResponse.json({error: 'Malformed URL encoding.'}, {status: 400, headers})
      : new NextResponse('Bad request: malformed URL encoding.', {status: 400, headers});
  }
  return NextResponse.next();
}

export const config = {matcher: ['/api/:path*', '/review/:path*']};
