import {db, json, failure} from '@/lib/server';
import {basicPasswordValid, parsePostmark, parseResend, parseSes, snsConfirmUrl, svixValid, tokenValid, type MailEvent, type SnsEnvelope} from '@/lib/mail-events';
import {mailDevMode, suppress} from '@/lib/mail-outbox';

// Local dev mode only (SCOPEFLOW_OTP_DEV=1 on a localhost APP_URL): fixed test secrets, so the suites
// can exercise the webhooks without configuring a provider. Never used on a deployed server.
export const DEV_WEBHOOK_SECRET = 'scopeflow-dev-mail-webhook-secret';
const DEV_RESEND_SECRET = 'whsec_' + Buffer.from('scopeflow-dev-resend-webhook-secret').toString('base64');
export const runtime = 'nodejs';
type Ctx = {params: Promise<{provider: string}>};

// Bounce and complaint webhooks from all three mail providers (SF-19, WS-06). Each verified event
// adds its addresses to the one suppression list (scopeflow.mail_suppressions), so a hard bounce or
// complaint at any provider stops mail to that address from every provider. Retries of an event
// already processed are acknowledged and not re-applied. See lib/mail-events.ts for the auth.
const MAX = 256 * 1024;
export async function POST(request: Request, ctx: Ctx) {
  try {
    const {provider} = await ctx.params;
    if (!['resend', 'postmark', 'ses'].includes(provider)) return json({error: 'Unknown provider.'}, 404);
    const raw = await request.text();
    if (raw.length > MAX) return json({error: 'Payload too large.'}, 413);
    const secret = process.env.SCOPEFLOW_MAIL_WEBHOOK_SECRET?.trim() || (mailDevMode() ? DEV_WEBHOOK_SECRET : '');
    let event: MailEvent | null = null;
    let data: unknown;
    try { data = JSON.parse(raw); } catch { return json({error: 'Provide the event as JSON.'}, 400); }
    if (provider === 'resend') {
      const key = process.env.RESEND_WEBHOOK_SECRET?.trim() || (mailDevMode() ? DEV_RESEND_SECRET : '');
      if (!key) return json({error: 'Resend webhooks are not configured (RESEND_WEBHOOK_SECRET).'}, 503);
      const id = request.headers.get('svix-id');
      if (!svixValid(raw, {id, timestamp: request.headers.get('svix-timestamp'), signature: request.headers.get('svix-signature')}, key)) return json({error: 'Invalid signature.'}, 401);
      event = parseResend(data, id!);
    } else if (provider === 'postmark') {
      if (!secret) return json({error: 'Mail webhooks are not configured (SCOPEFLOW_MAIL_WEBHOOK_SECRET).'}, 503);
      if (!basicPasswordValid(request.headers.get('authorization'), secret)) return json({error: 'Unauthorized.'}, 401, {'WWW-Authenticate': 'Basic realm="scopeflow-mail-events"'});
      event = parsePostmark(data);
    } else {
      if (!secret) return json({error: 'Mail webhooks are not configured (SCOPEFLOW_MAIL_WEBHOOK_SECRET).'}, 503);
      if (!tokenValid(new URL(request.url).searchParams.get('token'), secret)) return json({error: 'Unauthorized.'}, 401);
      const envelope = data as SnsEnvelope;
      const topic = process.env.SCOPEFLOW_SES_SNS_TOPIC_ARN?.trim();
      if (topic && envelope.TopicArn !== topic) return json({error: 'Unknown topic.'}, 403);
      if (envelope.Type === 'SubscriptionConfirmation') {
        const url = snsConfirmUrl(envelope.SubscribeURL);
        if (!url) return json({error: 'Invalid subscription URL.'}, 400);
        const r = await fetch(url, {signal: AbortSignal.timeout(10000)}).catch(() => null);
        return json({confirmed: !!r?.ok});
      }
      event = parseSes(envelope);
    }
    if (!event || !event.addresses.length) return json({received: true, suppressed: 0});
    if (event.id) {
      const fresh = await db().prepare('INSERT INTO scopeflow.mail_provider_events (provider,event_id,created) VALUES (?,?,?) ON CONFLICT DO NOTHING RETURNING event_id').bind(provider, event.id.slice(0, 200), new Date().toISOString()).first();
      if (!fresh) return json({received: true, duplicate: true});
    }
    let n = 0;
    for (const a of event.addresses.slice(0, 50)) if (await suppress(a, event.reason, provider)) n++;
    return json({received: true, suppressed: n, reason: event.reason});
  } catch (e) { return failure(e); }
}
