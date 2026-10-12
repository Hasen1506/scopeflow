import {json, failure} from '@/lib/server';
import {drainNotifyEvents} from '@/lib/notify';
import {pruneBodies} from '@/lib/mail-outbox';
import {timingSafeEqual} from 'node:crypto';
export const runtime = 'nodejs';

// Sends queued client notices (change orders and invoices queued by the database triggers, from any
// route or MCP) and retries outbox mail that failed over (WS-06). For the notifications cron
// (scripts/drain-notifications.mjs, every few minutes) and the daily reminders job.
// Authorized with SCOPEFLOW_CRON_SECRET as a bearer token; without that secret the route is off.
export async function POST(request: Request) {
  try {
    const secret = process.env.SCOPEFLOW_CRON_SECRET?.trim();
    if (!secret) return json({error: 'Notification draining is not configured (SCOPEFLOW_CRON_SECRET).', code: 'cron_disabled'}, 503);
    const given = Buffer.from(/^bearer\s+(.+)$/i.exec(request.headers.get('authorization') ?? '')?.[1]?.trim() ?? ''), expected = Buffer.from(secret);
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) return json({error: 'Unauthorized.'}, 401);
    const results = await drainNotifyEvents({limit: 100});
    await pruneBodies();
    return json({processed: results.length, delivered: results.filter(r => r.delivered).length, statuses: results.map(r => r.status)});
  } catch (e) { return failure(e); }
}
