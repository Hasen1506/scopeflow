// SF-14: privacy-preserving product analytics (activation funnel).
//
// Events are recorded server-side by database triggers (migration 0016) when each step happens:
// link_opened (a client first opens a version's link), decision, co_proposed, co_approved,
// payment_marked and invoice_issued. A row holds the event name, the owner's account id, the
// project id and a few numbers (version, ledger seq) — never a client email, phone, name, IP
// address, user agent or free text. Owners opt out per account; SCOPEFLOW_ANALYTICS=off stops the
// export and the counts, and `ALTER ROLE ... SET scopeflow.analytics='off'` stops collection.
// Optional export to PostHog (EU) with POSTHOG_KEY / POSTHOG_HOST: the distinct id is a salted hash
// of the owner id, so PostHog never sees Scopeflow account ids either.
import {createHash} from 'node:crypto';

type Env = Record<string, string | undefined>;
export const ANALYTICS_EVENTS = ['link_opened', 'decision', 'co_proposed', 'co_approved', 'payment_marked', 'invoice_issued'] as const;
export type AnalyticsEvent = typeof ANALYTICS_EVENTS[number];
/** Funnel order for the admin counts. */
export const FUNNEL: AnalyticsEvent[] = ['link_opened', 'decision', 'co_proposed', 'co_approved', 'invoice_issued', 'payment_marked'];

export function analyticsEnabled(env: Env = process.env) { return (env.SCOPEFLOW_ANALYTICS ?? 'on').trim().toLowerCase() !== 'off'; }
export function posthogConfig(env: Env = process.env) {
  const key = env.POSTHOG_KEY?.trim();
  if (!key || !analyticsEnabled(env)) return null;
  const host = (env.POSTHOG_HOST?.trim() || 'https://eu.i.posthog.com').replace(/\/+$/, '');
  try { if (new URL(host).protocol !== 'https:') return null; } catch { return null; }
  return {key, host};
}

/** Property keys an event may carry. Anything else is dropped before export (defence in depth). */
const ALLOWED_PROPS = new Set(['version', 'outcome', 'seq', 'ref_seq', 'actor']);
const PII = /@|\b\d{1,3}(?:\.\d{1,3}){3}\b|[0-9a-f]{0,4}:[0-9a-f:]{6,}|\+\d{7,}/i;
/** The props of an event with only allow-listed keys and no value that looks like an email, IP or phone. */
export function safeProps(props: Record<string, unknown>): Record<string, string | number> {
  const out: Record<string, string | number> = {};
  for (const [k, v] of Object.entries(props ?? {})) {
    if (!ALLOWED_PROPS.has(k)) continue;
    if (typeof v === 'number' && Number.isFinite(v)) out[k] = v;
    else if (typeof v === 'string' && v.length <= 40 && !PII.test(v)) out[k] = v;
  }
  return out;
}

export function distinctId(owner: string, env: Env = process.env) {
  return createHash('sha256').update('scopeflow-analytics:' + (env.SCOPEFLOW_ANALYTICS_SALT ?? env.SCOPEFLOW_SIGNING_SECRET ?? '') + ':' + owner).digest('hex').slice(0, 32);
}

export type EventRow = {id: number; event: string; owner: string; project_id: string; props: Record<string, unknown> | string; created: string};
/** PostHog batch body (https://posthog.com/docs/api/capture#batch-events). */
export function posthogBatch(rows: EventRow[], apiKey: string, env: Env = process.env) {
  return {
    api_key: apiKey,
    batch: rows.map(r => ({
      event: 'scopeflow_' + r.event,
      distinct_id: distinctId(r.owner, env),
      timestamp: new Date(r.created).toISOString(),
      properties: {...safeProps(typeof r.props === 'string' ? JSON.parse(r.props) : r.props), project: createHash('sha256').update(r.project_id).digest('hex').slice(0, 16), $process_person_profile: false, $ip: null},
    })),
  };
}
