// WS-01 (L6): the FX provider chain keeps every currency and records the source of the locked rate.
// Pure: fetch is a local double; no network.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import '../support/property.mjs';

const FX = await import('../../lib/fx.ts');
const {scopeSchema} = await import('../../lib/scope.ts');
const {currencyList} = await import('../../lib/currency.ts');
const json = (body, status = 200) => new Response(JSON.stringify(body), {status, headers: {'Content-Type': 'application/json'}});
let clock = 1;
const now = () => (clock += 4_000_000); // past the hour cache each call

// @covers L6
test('L6 regression: AED → INR with ECB lacking it uses FBIL, and the source is recorded', async () => {
  const seen = [];
  const fetchImpl = async url => {
    const u = new URL(String(url)); seen.push(u.host + u.pathname);
    if (u.host === 'ecb.test') return json({message: 'not found'}, 404); // ECB publishes no AED
    if (u.host === 'fbil.test') {
      assert.deepEqual(Object.fromEntries(u.searchParams), {base: 'AED', quotes: 'INR', providers: 'fbil'});
      return json([{date: '2026-10-09', base: 'AED', quote: 'INR', rate: 26.3049}]);
    }
    throw new Error('unexpected host ' + u.host);
  };
  const env = {SCOPEFLOW_FX_URL: 'http://ecb.test/v1/latest', SCOPEFLOW_FBIL_URL: 'http://fbil.test/v2/rates'};
  const rate = await FX.referenceRate('AED', 'INR', {env, fetchImpl, now: now()});
  assert.deepEqual(rate, {rate: 26.3049, as_of: '2026-10-09', source: 'FBIL reference rate'});
  assert.deepEqual(seen, ['ecb.test/v1/latest', 'fbil.test/v2/rates']);
  // The locked term keeps rate, source and date.
  const content = scopeSchema.parse({title: 'Dubai client', client: 'Gulf Co', deliverables: 'Some work', exclusions: '', fee: 1000, currency: 'AED', revisions: 1, due: '', notes: '', fx: {currency: 'INR', ...rate}});
  assert.deepEqual(content.fx, {currency: 'INR', rate: 26.3049, as_of: '2026-10-09', source: 'FBIL reference rate'});
  // FBIL is only asked for INR pairs it publishes; then the configurable fallback.
  assert.deepEqual(FX.fxProviders('LKR', 'INR', env).map(p => p.name), ['primary']);
  assert.deepEqual(FX.fxProviders('LKR', 'INR', {...env, SCOPEFLOW_FX_FALLBACK_URL: 'http://fb.test/latest'}).map(p => p.name), ['primary', 'fallback']);
  const fb = await FX.referenceRate('LKR', 'INR', {env: {...env, SCOPEFLOW_FX_FALLBACK_URL: 'http://fb.test/latest'}, now: now(), fetchImpl: async url => {
    const u = new URL(String(url));
    return u.host === 'fb.test' ? json({date: '2026-10-08', rates: {INR: 0.2873}}) : json({}, 404);
  }});
  assert.deepEqual(fb, {rate: 0.2873, as_of: '2026-10-08', source: 'Reference rate (fb.test)'});
  for (const c of ['USD', 'GBP', 'EUR', 'JPY', 'AED', 'IDR']) assert.ok(FX.fxProviders(c, 'INR', {}).some(p => p.name === 'fbil'), c);
  // A custom primary (CI's local double) never pulls in the public FBIL default: localhost-only network.
  assert.deepEqual(FX.fxProviders('AED', 'INR', {SCOPEFLOW_FX_URL: 'http://127.0.0.1:55434/fx'}).map(p => p.name), ['primary']);
  assert.equal(currencyList.length, 29, 'every currency is kept');
});

// @covers L6
test('L6 regression: all providers fail → manual rate with its source and date', async () => {
  const env = {SCOPEFLOW_FX_URL: 'http://ecb.test/v1/latest', SCOPEFLOW_FBIL_URL: 'http://fbil.test/v2/rates', SCOPEFLOW_FX_FALLBACK_URL: 'http://fb.test/latest'};
  const err = await FX.referenceRate('AED', 'INR', {env, now: now(), fetchImpl: async () => { throw new Error('offline'); }}).then(() => null, e => e);
  assert.ok(err instanceof FX.FxError);
  assert.equal(err.status, 502); assert.equal(err.manual, true);
  assert.deepEqual(err.tried, ['primary', 'fbil', 'fallback']);
  assert.match(err.message, /Enter the rate, its source and its date yourself/);
  assert.deepEqual([...FX.MANUAL_RATE_FIELDS], ['rate', 'source', 'as_of']);
  const none = await FX.referenceRate('AED', 'INR', {env, now: now(), fetchImpl: async () => json({date: '2026-10-09', rates: {}})}).then(() => null, e => e);
  assert.match(none.message, /No reference rate is published for AED to INR/); assert.equal(none.manual, true);
  // The manual rate is accepted only with a source and a date.
  const scope = fx => ({title: 'Manual rate', client: 'Gulf Co', deliverables: 'Some work', exclusions: '', fee: 1000, currency: 'AED', revisions: 1, due: '', notes: '', fx});
  assert.equal(scopeSchema.safeParse(scope({currency: 'INR', rate: 26.3, as_of: '2026-10-09', source: 'Bank quote'})).success, true);
  assert.equal(scopeSchema.safeParse(scope({currency: 'INR', rate: 26.3, as_of: '', source: 'Bank quote'})).success, false);
  assert.equal(scopeSchema.safeParse(scope({currency: 'INR', rate: 26.3, as_of: '2026-10-09', source: ''})).success, false);
  // "off" disables every automatic lookup.
  const off = await FX.referenceRate('AED', 'INR', {env: {SCOPEFLOW_FX_URL: 'off'}}).then(() => null, e => e);
  assert.deepEqual([off.status, off.manual], [503, true]);
});

// @covers L6
test('L6: v1 and v2 response shapes', () => {
  assert.deepEqual(FX.parseRate({date: '2026-10-01', rates: {INR: 83.25}}, 'USD', 'INR'), {rate: 83.25, as_of: '2026-10-01'});
  assert.deepEqual(FX.parseRate([{date: '2026-10-05', base: 'AED', quote: 'INR', rate: 26.2145}], 'AED', 'INR'), {rate: 26.2145, as_of: '2026-10-05'});
  assert.equal(FX.parseRate([{date: '2026-10-05', base: 'USD', quote: 'INR', rate: 1}], 'AED', 'INR'), null);
  assert.equal(FX.parseRate({date: 'yesterday', rates: {INR: 1}}, 'USD', 'INR'), null);
  assert.equal(FX.parseRate({date: '2026-10-01', rates: {INR: -1}}, 'USD', 'INR'), null);
});
