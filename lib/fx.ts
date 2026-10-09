import {currencyCodes} from './currency';

// Reference exchange rates for the "second currency" term of a scope. The owner fetches today's
// rate while drafting; the rate itself is then fixed in the scope content the client signs, so a
// later lookup never changes an agreement. Default source: the Frankfurter API (European Central
// Bank reference rates, no key). SCOPEFLOW_FX_URL points at another Frankfurter-compatible endpoint,
// or "off" to disable lookups (owners can still type a rate).

type Env = Record<string, string | undefined>;
export class FxError extends Error {
  readonly status: number;
  constructor(message: string, status = 502) { super(message); this.status = status; }
}
const DEFAULT_URL = 'https://api.frankfurter.dev/v1/latest';

export function fxUrl(env: Env = process.env) {
  const v = env.SCOPEFLOW_FX_URL?.trim();
  if (v === 'off') return null;
  return v || DEFAULT_URL;
}

const cache = new Map<string, {at: number; value: {rate: number; as_of: string; source: string}}>();
/** `to` per one `from`, as published on `as_of`. Cached for an hour per pair. */
export async function referenceRate(from: string, to: string, {env = process.env, fetchImpl = fetch, now = Date.now()}: {env?: Env; fetchImpl?: typeof fetch; now?: number} = {}) {
  if (!currencyCodes.includes(from) || !currencyCodes.includes(to) || from === to) throw new FxError('Pick two different supported currencies.', 400);
  const url = fxUrl(env);
  if (!url) throw new FxError('Rate lookups are turned off on this server. Enter the rate yourself.', 503);
  const key = `${url}|${from}|${to}`, hit = cache.get(key);
  if (hit && now - hit.at < 3600_000) return hit.value;
  let data: {date?: string; rates?: Record<string, number>};
  try {
    const r = await fetchImpl(`${url}?base=${from}&symbols=${to}`, {signal: AbortSignal.timeout(8000), headers: {Accept: 'application/json'}});
    if (!r.ok) throw new Error(String(r.status));
    data = await r.json();
  } catch { throw new FxError('The rate service could not be reached. Enter the rate yourself.'); }
  const rate = data.rates?.[to];
  if (typeof rate !== 'number' || !(rate > 0) || !/^\d{4}-\d{2}-\d{2}$/.test(data.date ?? '')) throw new FxError(`No reference rate is published for ${from} to ${to}. Enter the rate yourself.`);
  const value = {rate: Math.round(rate * 1e6) / 1e6, as_of: data.date!, source: url === DEFAULT_URL ? 'ECB reference rate' : 'Reference rate'};
  cache.set(key, {at: now, value});
  return value;
}
