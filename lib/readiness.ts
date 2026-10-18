// M30: health vs readiness.
//
// /api/health is what Render polls: the database answers and, in production, records are signed
// with the dedicated key (C1). Anything else being off must not take the service down, so it is
// reported by /api/readiness instead (admin token): mail, inbound, payment webhooks, cron runs,
// timestamps, one-time-code spend, AI models, encryption, analytics and proxy configuration.
//
// Other workstreams add their own checks to READINESS_CHECKS below (a one-line change request to
// WS-10): each check returns {status, ...details} and must never throw or reveal a secret.
import {db} from '@/lib/server';
import {signingStatus} from '@/lib/identity';
import {mailConfig} from '@/lib/mail';
import {inboundConfig} from '@/lib/inbound';
import {smsConfig} from '@/lib/sms';
import {otpDevMode} from '@/lib/otp';
import {llmStatus} from '@/lib/llm';
import {razorpayConfig, webhookSecret} from '@/lib/razorpay';
import {stripeConfig, stripeWebhookSecret} from '@/lib/stripe';
import {tsaConfig} from '@/lib/tsa';
import {encryptionConfigured} from '@/lib/crypto-box';
import {analyticsEnabled, posthogConfig} from '@/lib/analytics';
import {configuredOrigin, trustedHops} from '@/lib/origin';

type Env = Record<string, string | undefined>;
export type CheckStatus = 'ok' | 'warn' | 'off' | 'fail';
export type Check = {status: CheckStatus} & Record<string, unknown>;

/** Health: only what must hold for the service to accept traffic. */
export async function health(env: Env = process.env): Promise<{ok: boolean; database: boolean; signing: string; reason?: string}> {
  const signing = signingStatus(env);
  let database = false;
  try { await db().prepare('SELECT 1 AS ok').first(); database = true; } catch { /* reported below */ }
  if (!database) return {ok: false, database, signing, reason: 'database_unreachable'};
  if (env.NODE_ENV === 'production' && signing !== 'dedicated') return {ok: false, database, signing, reason: 'signing_not_dedicated'};
  return {ok: true, database, signing};
}

/** Cron jobs and the longest gap (hours) that still counts as fresh. Renders' schedules are daily. */
export const CRON_JOBS: Record<string, number> = {retention: 26, reminders: 26, reconcile: 26, 'check-models': 26, heads: 26, housekeeping: 26, analytics: 26};

async function tableExists(name: string) {
  const r = await db().prepare('SELECT to_regclass(?) IS NOT NULL AS present').bind('scopeflow.' + name).first<{present: boolean}>();
  return !!r?.present;
}

const checks: Record<string, (env: Env) => Promise<Check> | Check> = {
  signing: env => { const s = signingStatus(env); return {status: s === 'dedicated' ? 'ok' : env.NODE_ENV === 'production' ? 'fail' : 'warn', source: s}; },
  database: async () => { try { await db().prepare('SELECT 1 AS ok').first(); return {status: 'ok'}; } catch { return {status: 'fail'}; } },
  db_role: async () => {
    // C7: the runtime role should not own the tables (then it could disable the triggers).
    const r = await db().prepare("SELECT current_user::text AS role, (SELECT tableowner::text FROM pg_tables WHERE schemaname='scopeflow' AND tablename='versions') AS owner, (SELECT rolsuper FROM pg_roles WHERE rolname=current_user) AS superuser").first<{role: string; owner: string; superuser: boolean}>();
    const owns = !!r && (r.role === r.owner || !!r.superuser);
    return {status: owns ? 'warn' : 'ok', runtime_owns_tables: owns, ...(owns ? {hint: 'Point DATABASE_URL at a login role granted scopeflow_app (docs/ws-10.md).'} : {})};
  },
  mail: env => { const m = mailConfig(env); return m ? {status: 'ok', provider: m.provider} : {status: 'off'}; },
  inbound: env => (inboundConfig(env) ? {status: 'ok', domain: inboundConfig(env)!.domain} : {status: 'off'}),
  otp: env => { const sms = smsConfig(env); return {status: mailConfig(env) || sms || otpDevMode(env) ? 'ok' : 'off', channels: ['email', ...(sms?.channels ?? [])], dev_mode: otpDevMode(env)}; },
  otp_spend: async () => {
    // Codes sent today (WS-02 adds otp_spend with cost; until then the codes table is counted).
    const since = new Date(Date.now() - 86400_000).toISOString();
    if (await tableExists('otp_spend')) { const r = await db().prepare('SELECT COUNT(*) AS n FROM scopeflow.otp_spend WHERE created > ?').bind(since).first<{n: number}>(); return {status: 'ok', last_24h: Number(r?.n ?? 0)}; }
    const r = await db().prepare('SELECT COUNT(*) AS n FROM review_otps WHERE created > ?').bind(since).first<{n: number}>().catch(() => null);
    return {status: 'ok', last_24h: Number(r?.n ?? 0)};
  },
  payments: async env => {
    const razorpay = {keys: !!razorpayConfig(env), webhook: !!webhookSecret(env)};
    const stripe = {keys: !!stripeConfig(env), webhook: !!stripeWebhookSecret(env)};
    const warnings: string[] = [];
    if (razorpay.keys && !razorpay.webhook) warnings.push('Razorpay keys without RAZORPAY_WEBHOOK_SECRET: captured payments cannot be confirmed.');
    if (stripe.keys && !stripe.webhook) warnings.push('Stripe key without STRIPE_WEBHOOK_SECRET: paid sessions cannot be confirmed.');
    let accounts: {total: number; without_webhook: number} | null = null;
    if (await tableExists('payment_accounts')) {
      // WS-04: per-account webhooks. Column names are probed so this keeps working as the table evolves.
      const cols = (await db().prepare("SELECT column_name FROM information_schema.columns WHERE table_schema='scopeflow' AND table_name='payment_accounts'").all<{column_name: string}>()).results.map(c => c.column_name);
      const webhookCol = ['webhook_secret_box', 'webhook_secret', 'webhook_secret_enc'].find(c => cols.includes(c));
      const r = await db().prepare(`SELECT COUNT(*) AS total${webhookCol ? `, COUNT(*) FILTER (WHERE ${webhookCol} IS NULL) AS missing` : ', 0 AS missing'} FROM scopeflow.payment_accounts`).first<{total: number; missing: number}>();
      accounts = {total: Number(r?.total ?? 0), without_webhook: Number(r?.missing ?? 0)};
      if (accounts.without_webhook) warnings.push(`${accounts.without_webhook} payment account(s) have no webhook secret.`);
    }
    const any = razorpay.keys || stripe.keys || (accounts?.total ?? 0) > 0;
    return {status: !any ? 'off' : warnings.length ? 'warn' : 'ok', razorpay, stripe, ...(accounts ? {accounts} : {}), ...(warnings.length ? {warnings} : {})};
  },
  cron: async () => {
    const rows = (await db().prepare("SELECT DISTINCT ON (job) job, started, finished, status FROM scopeflow.cron_runs ORDER BY job, started DESC").all<{job: string; started: string; finished: string | null; status: string}>()).results;
    const jobs: Record<string, unknown> = {};
    let worst: CheckStatus = 'ok';
    for (const [job, hours] of Object.entries(CRON_JOBS)) {
      const r = rows.find(x => x.job === job);
      const stale = !r || Date.now() - Date.parse(r.started) > hours * 3600_000;
      jobs[job] = r ? {last_run: r.started, finished: r.finished, status: r.status, stale} : {last_run: null, stale: true};
      if (r?.status === 'failed') worst = 'fail'; else if (stale && worst === 'ok') worst = 'warn';
    }
    return {status: worst, jobs};
  },
  tsa: async env => {
    const c = tsaConfig(env);
    if (!c) return {status: env.NODE_ENV === 'production' ? 'warn' : 'off', hint: 'Set SCOPEFLOW_TSA_URL (RFC 3161) so anchors and ledger heads carry independent timestamps.'};
    const r = await db().prepare('SELECT MAX(created) AS last FROM timestamps').first<{last: string | null}>().catch(() => null);
    return {status: 'ok', url_host: new URL(c.url).host, last_token: r?.last ?? null};
  },
  heads: async () => {
    const r = await db().prepare('SELECT MAX(date) AS last FROM scopeflow.head_digests').first<{last: string | null}>();
    const yesterday = new Date(Date.now() - 86400_000).toISOString().slice(0, 10);
    return {status: r?.last && r.last >= new Date(Date.now() - 2 * 86400_000).toISOString().slice(0, 10) ? 'ok' : 'warn', last_published: r?.last ?? null, expected: yesterday};
  },
  models: env => { const s = llmStatus(env); return s.enabled ? {status: s.warning ? 'warn' : 'ok', provider: s.provider, model: s.model, careful_model: s.careful_model, ...(s.warning ? {warning: s.warning} : {})} : {status: 'off'}; },
  encryption: env => ({status: encryptionConfigured(env) ? 'ok' : 'off'}),
  analytics: env => ({status: analyticsEnabled(env) ? 'ok' : 'off', export: posthogConfig(env) ? 'posthog' : null}),
  proxy: env => ({status: env.NODE_ENV === 'production' && !env.SCOPEFLOW_TRUSTED_PROXY && trustedHops(env) === 0 ? 'warn' : 'ok', trusted_proxy: env.SCOPEFLOW_TRUSTED_PROXY ?? null, trusted_hops: trustedHops(env)}),
  canonical: env => { const o = configuredOrigin(env); return {status: o ? 'ok' : env.NODE_ENV === 'production' ? 'fail' : 'warn', app_url: o}; },
};
/** Extension point: name → check. Keep each check cheap, side-effect free and secret free. */
export const READINESS_CHECKS = checks;

export async function readiness(env: Env = process.env) {
  const results: Record<string, Check> = {};
  await Promise.all(Object.entries(READINESS_CHECKS).map(async ([name, check]) => {
    try { results[name] = await check(env); } catch (e) { results[name] = {status: 'fail', error: e instanceof Error ? e.message.slice(0, 200) : 'check failed'}; }
  }));
  const order: CheckStatus[] = ['ok', 'off', 'warn', 'fail'];
  const overall = Object.values(results).reduce<CheckStatus>((w, c) => (order.indexOf(c.status) > order.indexOf(w) && c.status !== 'off' ? c.status : w), 'ok');
  return {status: overall, checked: new Date().toISOString(), checks: Object.fromEntries(Object.keys(READINESS_CHECKS).map(k => [k, results[k]]))};
}

export {adminAuthorized} from './admin-auth';
