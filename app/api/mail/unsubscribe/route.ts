import {json, failure} from '@/lib/server';
import {verifyUnsubscribe} from '@/lib/unsubscribe';
import {suppress} from '@/lib/mail-outbox';
export const runtime = 'nodejs';

// One-click unsubscribe from reminder mail (RFC 8058, M19; WS-06). Only POST unsubscribes: it is the
// mail client's one-click request, and the button on the confirmation page. GET (a person clicking
// the link, or a link scanner prefetching it, S2) only shows that confirmation page and changes nothing.
// Only bulk mail (reminders) stops; review links, codes and change-order notices still arrive.
const escape = (s: string) => s.replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'})[c]!);
function page(title: string, body: string, status: number) {
  return new Response(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><meta name="robots" content="noindex"><title>Scopeflow</title><body style="font-family:system-ui,sans-serif;max-width:32rem;margin:3rem auto;padding:0 1rem"><h1 style="font-size:1.25rem">${title}</h1>${body}</body>`,
    {status, headers: {'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff'}});
}
const token = (request: Request) => new URL(request.url).searchParams.get('t');
const wantsHtml = (request: Request) => (request.headers.get('accept') ?? '').includes('text/html');

export async function POST(request: Request) {
  try {
    const address = verifyUnsubscribe(token(request));
    if (address) await suppress(address, 'unsubscribed', null);
    if (wantsHtml(request)) {
      return address
        ? page('Unsubscribed', '<p>You will not get reminder emails from Scopeflow any more. Review links and messages you need to act on still arrive.</p>', 200)
        : page('Link not valid', '<p>This unsubscribe link is not valid.</p>', 400);
    }
    return address ? json({unsubscribed: true}) : json({error: 'This unsubscribe link is not valid.'}, 400);
  } catch (e) { return failure(e); }
}
export async function GET(request: Request) {
  try {
    const t = token(request);
    if (!verifyUnsubscribe(t)) return page('Link not valid', '<p>This unsubscribe link is not valid.</p>', 400);
    return page('Unsubscribe from reminders?',
      `<p>Stop reminder emails from Scopeflow to this address. Review links and messages you need to act on still arrive.</p><form method="post" action="?t=${escape(encodeURIComponent(t!))}"><button type="submit" style="font:inherit;padding:.5rem 1rem">Unsubscribe</button></form>`, 200);
  } catch (e) { return failure(e); }
}
