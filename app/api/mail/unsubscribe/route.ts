import {json, failure} from '@/lib/server';
import {verifyUnsubscribe} from '@/lib/unsubscribe';
import {suppress} from '@/lib/mail-outbox';
export const runtime = 'nodejs';

// One-click unsubscribe from reminder mail (RFC 8058, M19; WS-06). POST is the mail client's
// one-click request; GET (a person clicking the link) shows a confirmation and unsubscribes too.
// Only bulk mail (reminders) stops; review links, codes and change-order notices still arrive.
async function handle(request: Request) {
  const address = verifyUnsubscribe(new URL(request.url).searchParams.get('t'));
  if (!address) return null;
  await suppress(address, 'unsubscribed', null);
  return address;
}
export async function POST(request: Request) {
  try { return (await handle(request)) ? json({unsubscribed: true}) : json({error: 'This unsubscribe link is not valid.'}, 400); } catch (e) { return failure(e); }
}
export async function GET(request: Request) {
  try {
    const ok = await handle(request);
    const text = ok ? 'You will not get reminder emails from Scopeflow any more. Review links and messages you need to act on still arrive.' : 'This unsubscribe link is not valid.';
    return new Response(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Scopeflow</title><body style="font-family:system-ui,sans-serif;max-width:32rem;margin:3rem auto;padding:0 1rem"><h1 style="font-size:1.25rem">${ok ? 'Unsubscribed' : 'Link not valid'}</h1><p>${text}</p></body>`,
      {status: ok ? 200 : 400, headers: {'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer'}});
  } catch (e) { return failure(e); }
}
