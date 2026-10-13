import {currencyCodes} from './currency';

// Reference exchange rates for the "second currency" term of a scope. The owner fetches today's
// rate while drafting; the rate itself is then fixed in the scope content the client signs
// ({rate, source, as_of}), so a later lookup never changes an agreement.
//
// WS-01 (L6): a provider chain, so every configured currency can get a rate:
//   1. Frankfurter / ECB reference rates (SCOPEFLOW_FX_URL: another Frankfurter-compatible endpoint,
//      or "off" to disable every lookup; owners can still type a rate);
//   2. FBIL reference rates for INR pairs (USD, GBP, EUR, JPY, AED, IDR; published around 13:00 IST
//      on Mumbai business days), through Frankfurter's v2 FBIL provider by default
//      (SCOPEFLOW_FBIL_URL: another v2-compatible endpoint, or "off");
//   3. a second configurable provider (SCOPEFLOW_FX_FALLBACK_URL, Frankfurter v1 or v2 shape);
//   4. otherwise the owner enters the rate with its source and date (the scope schema requires both).
// The rate that is locked always records which source published it and on which day.

type Env = Record<string, string | undefined>;
export type FxRate = {rate: number; as_of: string; source: string};
export class FxError extends Error {
  readonly status: number;
  /** True when every provider failed: the owner must enter the rate, its source and its date. */
  readonly manual: boolean;
  /** The providers that were asked, in order. */
  readonly tried: string[];
  constructor(message: string, status = 502, {manual = status === 502 || status === 503, tried = [] as string[]} = {}) {
    super(message); this.status = status; this.manual = manual; this.tried = tried;
  }
}
const DEFAULT_URL = 'https://api.frankfurter.dev/v1/latest';
const DEFAULT_FBIL_URL = 'https://api.frankfurter.dev/v2/rates';
/** Currencies FBIL publishes an INR reference rate for (AED and IDR since 5 Jan 2026). */
export const FBIL_CURRENCIES = ['USD', 'GBP', 'EUR', 'JPY', 'AED', 'IDR'];
/** The fields the owner fills in when no provider has a rate. */
export const MANUAL_RATE_FIELDS = ['rate', 'source', 'as_of'] as const;

export function fxUrl(env: Env = process.env) {
  const v = env.SCOPEFLOW_FX_URL?.trim();
  if (v === 'off') return null;
  return v || DEFAULT_URL;
}
export function fbilUrl(env: Env = process.env) {
  const primary = env.SCOPEFLOW_FX_URL?.trim();
  if (primary === 'off') return null;
  const v = env.SCOPEFLOW_FBIL_URL?.trim();
  if (v === 'off') return null;
  // The public FBIL default only joins the default chain: a server that points SCOPEFLOW_FX_URL at
  // its own provider (or a local test double) chooses every provider itself, so it never reaches out.
  return v || (primary ? null : DEFAULT_FBIL_URL);
}
export function fallbackUrl(env: Env = process.env) {
  if (env.SCOPEFLOW_FX_URL?.trim() === 'off') return null;
  const v = env.SCOPEFLOW_FX_FALLBACK_URL?.trim();
  return v && v !== 'off' ? v : null;
}

type Provider = {name: string; url: string; source: string; query: string};
/** The providers to ask for `from` → `to`, in order. */
export function fxProviders(from: string, to: string, env: Env = process.env): Provider[] {
  const out: Provider[] = [];
  const primary = fxUrl(env);
  if (primary) out.push({name: primary === DEFAULT_URL ? 'ecb' : 'primary', url: primary, source: primary === DEFAULT_URL ? 'ECB reference rate' : 'Reference rate', query: `?base=${from}&symbols=${to}`});
  const fbil = fbilUrl(env);
  const other = from === 'INR' ? to : to === 'INR' ? from : '';
  if (fbil && FBIL_CURRENCIES.includes(other)) out.push({name: 'fbil', url: fbil, source: 'FBIL reference rate', query: `?base=${from}&quotes=${to}&providers=fbil`});
  const fallback = fallbackUrl(env);
  if (fallback) out.push({name: 'fallback', url: fallback, source: `Reference rate (${hostOf(fallback)})`, query: `?base=${from}&symbols=${to}`});
  return out;
}
const hostOf = (url: string) => { try { return new URL(url).host; } catch { return 'fallback provider'; } };

/** Read a Frankfurter v1 ({date, rates}) or v2 ([{date, base, quote, rate}]) answer. */
export function parseRate(data: unknown, from: string, to: string): {rate: number; as_of: string} | null {
  let rate: unknown, date: unknown;
  if (Array.isArray(data)) {
    const row = data.find(r => r && typeof r === 'object' && (r as {quote?: string}).quote === to && ((r as {base?: string}).base ?? from) === from) as {rate?: unknown; date?: unknown} | undefined;
    rate = row?.rate; date = row?.date;
  } else if (data && typeof data === 'object') {
    const d = data as {date?: unknown; rates?: Record<string, unknown>; rate?: unknown; quote?: unknown};
    rate = d.rates?.[to] ?? (d.quote === to ? d.rate : undefined); date = d.date;
  }
  if (typeof rate !== 'number' || !(rate > 0) || !Number.isFinite(rate) || typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  return {rate: Math.round(rate * 1e6) / 1e6, as_of: date};
}

const cache = new Map<string, {at: number; value: FxRate}>();
/** `to` per one `from`, as published on `as_of`, from the first provider in the chain that has it. Cached for an hour per pair. */
export async function referenceRate(from: string, to: string, {env = process.env, fetchImpl = fetch, now = Date.now()}: {env?: Env; fetchImpl?: typeof fetch; now?: number} = {}): Promise<FxRate> {
  if (!currencyCodes.includes(from) || !currencyCodes.includes(to) || from === to) throw new FxError('Pick two different supported currencies.', 400);
  const providers = fxProviders(from, to, env);
  if (!providers.length) throw new FxError('Rate lookups are turned off on this server. Enter the rate, its source and its date yourself.', 503);
  const key = `${providers.map(p => p.url).join(',')}|${from}|${to}`, hit = cache.get(key);
  if (hit && now - hit.at < 3600_000) return hit.value;
  let answered = false;
  const tried: string[] = [];
  for (const p of providers) {
    tried.push(p.name);
    let data: unknown;
    try {
      const r = await fetchImpl(`${p.url}${p.query}`, {signal: AbortSignal.timeout(8000), headers: {Accept: 'application/json'}});
      if (!r.ok) { if (r.status === 404 || r.status === 422) answered = true; continue; }
      data = await r.json();
    } catch { continue; }
    answered = true;
    const parsed = parseRate(data, from, to);
    if (!parsed) continue;
    const value = {...parsed, source: p.source};
    cache.set(key, {at: now, value});
    return value;
  }
  throw new FxError(answered
    ? `No reference rate is published for ${from} to ${to}. Enter the rate, its source and its date yourself.`
    : 'The rate service could not be reached. Enter the rate, its source and its date yourself.', 502, {manual: true, tried});
}
