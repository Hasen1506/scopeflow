import {appOrigin} from '@/lib/origin';
import {SUPPORT_EMAIL} from '@/config/site';
import {securityTxt} from '@/lib/security-txt';
export const dynamic = 'force-dynamic';
// RFC 9116 security contact. Served only once config/site.ts SUPPORT_EMAIL is set (404 until then).
export function GET(request: Request) {
  const text = securityTxt(SUPPORT_EMAIL, appOrigin(request));
  if (!text) return new Response('Not found\n', {status: 404, headers: {'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store'}});
  return new Response(text, {headers: {'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'public, max-age=86400'}});
}
