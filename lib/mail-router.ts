import {MAIL_PROVIDERS, MailError, providerConfig, sendMail, type MailConfig, type MailProvider, type SignatureEmail} from './mail';

// Mail router (SF-19, plan §8). Every outbound email has a message class, and each class has an
// ordered list of providers:
//
//   transactional  review links, change orders, invoices, receipts   resend > postmark > ses
//   auth           one-time codes, contact-change notices             postmark > resend > ses
//   bulk           reminders, digests, overdue nudges                 ses > resend
//
// SCOPEFLOW_MAIL_ROUTES overrides the order ("auth:postmark>ses;bulk:ses"); providers without
// credentials are skipped. A message fails over to the next provider on a 5xx answer, a timeout
// (10 s) or an unreachable provider, and skips a provider whose circuit breaker is open. A 4xx
// refusal never fails over: the address or message is the problem, not the provider. Each
// provider is tried at most once per attempt. Pure apart from the injected `send`.

export const MAIL_CLASSES = ['transactional', 'auth', 'bulk'] as const;
export type MailClass = typeof MAIL_CLASSES[number];
export type MailRoutes = Record<MailClass, MailProvider[]>;
export const DEFAULT_ROUTES: MailRoutes = {transactional: ['resend', 'postmark', 'ses'], auth: ['postmark', 'resend', 'ses'], bulk: ['ses', 'resend']};

type Env = Record<string, string | undefined>;

/** Parses SCOPEFLOW_MAIL_ROUTES ("class:p1>p2;class:p1" or JSON {class: [p1, p2]}); unknown parts are ignored. */
export function parseRoutes(value: string | undefined | null): MailRoutes {
  const routes: MailRoutes = {transactional: [...DEFAULT_ROUTES.transactional], auth: [...DEFAULT_ROUTES.auth], bulk: [...DEFAULT_ROUTES.bulk]};
  const raw = value?.trim();
  if (!raw) return routes;
  let pairs: [string, string[]][] = [];
  if (raw.startsWith('{')) {
    try { pairs = Object.entries(JSON.parse(raw) as Record<string, unknown>).map(([k, v]) => [k, Array.isArray(v) ? v.map(String) : String(v).split(/[>,]/)]); } catch { return routes; }
  } else pairs = raw.split(/[;\n]+/).map(part => { const [k, v = ''] = part.split(/[:=]/, 2); return [k, v.split(/[>,\s]+/)] as [string, string[]]; });
  for (const [k, list] of pairs) {
    const cls = k.trim().toLowerCase() as MailClass;
    if (!MAIL_CLASSES.includes(cls)) continue;
    const providers = [...new Set(list.map(p => p.trim().toLowerCase()).filter((p): p is MailProvider => (MAIL_PROVIDERS as readonly string[]).includes(p)))];
    if (providers.length) routes[cls] = providers;
  }
  return routes;
}

/** Every provider with credentials, keyed by name (one SCOPEFLOW_MAIL_FROM for all of them). */
export function providerConfigs(env: Env = process.env): Partial<Record<MailProvider, MailConfig>> {
  const from = env.SCOPEFLOW_MAIL_FROM?.trim();
  if (!from) return {};
  const out: Partial<Record<MailProvider, MailConfig>> = {};
  for (const provider of MAIL_PROVIDERS) {
    const creds = providerConfig(provider, env);
    if (creds) out[provider] = {provider, ...creds, from, replyTo: env.SCOPEFLOW_MAIL_REPLY_TO?.trim() || null, apiUrl: env[`SCOPEFLOW_MAIL_API_URL_${provider.toUpperCase()}`]?.trim().replace(/\/+$/, '') || env.SCOPEFLOW_MAIL_API_URL?.trim().replace(/\/+$/, '') || null};
  }
  return out;
}

/** The providers a class would use, in order, that have credentials. */
export function routeFor(cls: MailClass, env: Env = process.env, configs = providerConfigs(env)): MailProvider[] {
  return parseRoutes(env.SCOPEFLOW_MAIL_ROUTES)[cls].filter(p => configs[p]);
}

/**
 * Per-provider circuit breaker: `threshold` consecutive retryable failures open it for
 * `cooldownMs`; after that one trial request is let through (half-open). In memory, per process.
 */
export class CircuitBreaker {
  private state = new Map<string, {failures: number; openUntil: number}>();
  readonly threshold: number; readonly cooldownMs: number; private readonly clock: () => number;
  constructor(threshold = 3, cooldownMs = 60_000, clock: () => number = Date.now) { this.threshold = threshold; this.cooldownMs = cooldownMs; this.clock = clock; }
  isOpen(provider: string) { const s = this.state.get(provider); return !!s && s.openUntil > this.clock(); }
  success(provider: string) { this.state.delete(provider); }
  failure(provider: string) {
    const s = this.state.get(provider) ?? {failures: 0, openUntil: 0};
    s.failures++;
    if (s.failures >= this.threshold) { s.openUntil = this.clock() + this.cooldownMs; s.failures = 0; }
    this.state.set(provider, s);
  }
  /** For tests and readiness. */
  snapshot() { return Object.fromEntries([...this.state].map(([k, v]) => [k, {...v, open: v.openUntil > this.clock()}])); }
}
export const sharedBreaker = new CircuitBreaker();

export type Attempt = {provider: MailProvider; outcome: 'sent' | 'retryable' | 'refused' | 'skipped_open'; status: number | null; error: string | null};
export type RouteResult =
  | {status: 'sent'; provider: MailProvider; id: string | null; attempts: Attempt[]}
  | {status: 'refused' | 'failed' | 'no_provider'; provider: MailProvider | null; id: null; attempts: Attempt[]; error: string};
export type SendFn = (config: MailConfig, to: string, message: SignatureEmail, options: {idempotencyKey?: string; fromName?: string | null; replyTo?: string | null; headers?: Record<string, string> | null}) => Promise<{id: string | null}>;

const defaultSend: SendFn = (config, to, message, o) => sendMail(config, to, message, o.idempotencyKey, {fromName: o.fromName, replyTo: o.replyTo, headers: o.headers});

/** Sends one message along its class route with failover. Never throws for provider errors. */
export async function routeMail({cls, to, message, configs, routes = DEFAULT_ROUTES, breaker = sharedBreaker, send = defaultSend, idempotencyKey, fromName, replyTo, headers}: {
  cls: MailClass; to: string; message: SignatureEmail; configs: Partial<Record<MailProvider, MailConfig>>; routes?: MailRoutes; breaker?: CircuitBreaker; send?: SendFn;
  idempotencyKey?: string; fromName?: string | null; replyTo?: string | null; headers?: Record<string, string> | null;
}): Promise<RouteResult> {
  const order = routes[cls].filter(p => configs[p]);
  const attempts: Attempt[] = [];
  if (!order.length) return {status: 'no_provider', provider: null, id: null, attempts, error: 'Email delivery is not configured on this server.'};
  let lastError = 'Every email provider failed.';
  for (const provider of order) {
    if (breaker.isOpen(provider)) { attempts.push({provider, outcome: 'skipped_open', status: null, error: null}); continue; }
    try {
      // The same idempotency key on every provider: a provider that did accept a timed-out request
      // does not send it twice when the outbox retries.
      const result = await send(configs[provider]!, to, message, {idempotencyKey, fromName, replyTo, headers});
      breaker.success(provider);
      attempts.push({provider, outcome: 'sent', status: null, error: null});
      return {status: 'sent', provider, id: result.id, attempts};
    } catch (e) {
      const retryable = e instanceof MailError ? e.retryable : true;
      const message = e instanceof MailError ? e.message : 'The email provider failed.';
      attempts.push({provider, outcome: retryable ? 'retryable' : 'refused', status: e instanceof MailError ? e.status : null, error: message});
      lastError = message;
      if (!retryable) return {status: 'refused', provider, id: null, attempts, error: message};
      breaker.failure(provider);
    }
  }
  return {status: 'failed', provider: null, id: null, attempts, error: lastError};
}

/** Exponential retry delay for the outbox: 1, 5, 30 minutes, then 2 and 6 hours; null after that. */
export function retryDelayMs(attempts: number): number | null {
  const steps = [60_000, 300_000, 1_800_000, 7_200_000, 21_600_000];
  return attempts >= 1 && attempts <= steps.length ? steps[attempts - 1] : null;
}
