// WS-10 pure suites (no server): client IP resolution behind proxies, the canonical-host rule, the
// in-memory read limiter, the per-request session memo, the error taxonomy, envelope encryption and
// the analytics privacy filter. Seeded (FC_SEED), no network.
import '../support/fc-setup.mjs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fc} from '../support/property.mjs';

const origin = await import('../../lib/origin.ts');
const {memoryLimiter} = await import('../../lib/rate-memory.ts');
const {requestMemo} = await import('../../lib/auth/memo.ts');
const errors = await import('../../lib/errors.ts');
const box = await import('../../lib/crypto-box.ts');
const analytics = await import('../../lib/analytics.ts');

const H = (entries) => new Headers(entries);
const ipv4 = fc.tuple(fc.integer({min: 1, max: 223}), fc.nat(255), fc.nat(255), fc.integer({min: 1, max: 254})).map(p => p.join('.'));

// @covers H3
test('clientIp(): cloudflare, render-only, direct and malformed headers', () => {
  const render = {SCOPEFLOW_TRUSTED_HOPS: '1'};
  const cloudflare = {SCOPEFLOW_TRUSTED_HOPS: '1', SCOPEFLOW_TRUSTED_PROXY: 'cloudflare'};
  const cases = [
    // [label, headers, env, expected]
    ['direct, no proxy configured: headers ignored', {'x-forwarded-for': '6.6.6.6'}, {}, 'unknown'],
    ['direct, no headers', {}, render, 'unknown'],
    ['render: right-most hop is the client', {'x-forwarded-for': '6.6.6.6, 203.0.113.9'}, render, '203.0.113.9'],
    ['render: a single hop', {'x-forwarded-for': '198.51.100.4'}, render, '198.51.100.4'],
    ['render: spoofed list, real client last', {'x-forwarded-for': '1.1.1.1, 2.2.2.2, 3.3.3.3, 203.0.113.9'}, render, '203.0.113.9'],
    ['render: two trusted hops', {'x-forwarded-for': '6.6.6.6, 203.0.113.9, 10.0.0.2'}, {SCOPEFLOW_TRUSTED_HOPS: '2'}, '203.0.113.9'],
    ['render: IPv6 client', {'x-forwarded-for': '6.6.6.6, 2001:db8::1'}, render, '2001:db8::1'],
    ['render: malformed right-most hop', {'x-forwarded-for': '6.6.6.6, not-an-ip'}, render, 'unknown'],
    ['render: empty header', {'x-forwarded-for': ' , '}, render, 'unknown'],
    ['render: cf headers ignored without cloudflare mode', {'x-forwarded-for': '203.0.113.9', 'cf-connecting-ip': '6.6.6.6', 'cf-ray': 'x'}, render, '203.0.113.9'],
    ['cloudflare: edge peer + cf-ray -> cf-connecting-ip', {'x-forwarded-for': '6.6.6.6, 162.158.1.2', 'cf-connecting-ip': '203.0.113.9', 'cf-ray': '8a1b2c3d4e5f-BOM'}, cloudflare, '203.0.113.9'],
    ['cloudflare: IPv6 edge peer', {'x-forwarded-for': '2606:4700::6810:84e5', 'cf-connecting-ip': '2001:db8::7', 'cf-ray': 'r'}, cloudflare, '2001:db8::7'],
    ['cloudflare: spoofed cf headers from a non-Cloudflare peer', {'x-forwarded-for': '198.51.100.20', 'cf-connecting-ip': '6.6.6.6', 'cf-ray': 'fake'}, cloudflare, '198.51.100.20'],
    ['cloudflare: no cf-ray', {'x-forwarded-for': '162.158.1.2', 'cf-connecting-ip': '203.0.113.9'}, cloudflare, '162.158.1.2'],
    ['cloudflare: malformed cf-connecting-ip', {'x-forwarded-for': '162.158.1.2', 'cf-connecting-ip': '203.0.113.999', 'cf-ray': 'r'}, cloudflare, '162.158.1.2'],
    ['cloudflare tunnel (hops 0): cf-ray alone', {'cf-connecting-ip': '203.0.113.9', 'cf-ray': 'r'}, {SCOPEFLOW_TRUSTED_PROXY: 'cloudflare', SCOPEFLOW_TRUSTED_HOPS: '0'}, '203.0.113.9'],
    ['RENDER set, hops unset: defaults to 1', {'x-forwarded-for': '6.6.6.6, 203.0.113.9'}, {RENDER: 'true'}, '203.0.113.9'],
    ['invalid hops value', {'x-forwarded-for': '6.6.6.6, 203.0.113.9'}, {SCOPEFLOW_TRUSTED_HOPS: 'lots'}, 'unknown'],
  ];
  for (const [label, headers, env, expected] of cases) assert.equal(origin.clientIpFrom(H(headers), env), expected, label);
});

// @covers H3
test('a caller can never choose its rate-limit identity by adding X-Forwarded-For entries', () => {
  fc.assert(fc.property(fc.array(fc.oneof(ipv4, fc.string({maxLength: 20}).filter(s => !s.includes(','))), {maxLength: 8}), ipv4, fc.integer({min: 1, max: 3}), (spoofed, real, hops) => {
    const proxies = Array.from({length: hops - 1}, (_, i) => `10.0.0.${i + 1}`);
    const xff = [...spoofed, real, ...proxies].join(', ');
    assert.equal(origin.clientIpFrom(H({'x-forwarded-for': xff}), {SCOPEFLOW_TRUSTED_HOPS: String(hops)}), real);
  }));
});

// @covers H3
test('Cloudflare ranges and IPv6 rate keys', () => {
  assert.equal(origin.inRanges('104.16.0.1', origin.CLOUDFLARE_RANGES), true);
  assert.equal(origin.inRanges('104.32.0.1', origin.CLOUDFLARE_RANGES), false);
  assert.equal(origin.inRanges('2a06:98c7::1', origin.CLOUDFLARE_RANGES), true);
  assert.equal(origin.inRanges('2a06:98d0::1', origin.CLOUDFLARE_RANGES), false);
  assert.equal(origin.ipBytes('01.2.3.4'), null);
  assert.equal(origin.ipBytes('1:2:3:4:5:6:7:8:9'), null);
  assert.deepEqual(origin.ipBytes('::ffff:1.2.3.4')?.slice(12), [1, 2, 3, 4]);
  // Every address in one /64 shares a key (rotating the interface id does not reset the limit).
  assert.equal(origin.ipRateKey('2001:db8:1:2:aaaa::1'), origin.ipRateKey('2001:db8:1:2:ffff:ffff:ffff:ffff'));
  assert.notEqual(origin.ipRateKey('2001:db8:1:2::1'), origin.ipRateKey('2001:db8:1:3::1'));
  assert.equal(origin.ipRateKey('::ffff:192.0.2.1'), '192.0.2.1');
  assert.equal(origin.ipRateKey('garbage'), 'unknown');
});

// @covers H16 OP-01
test('canonical host: pages 308 to APP_URL, API calls 421, machine paths and internal hosts untouched', () => {
  const env = {APP_URL: 'https://scope-flow.tech'};
  assert.deepEqual(origin.canonicalHostDecision('scopeflow-qnng.onrender.com', '/review/x', '', env), {action: 'redirect', location: 'https://scope-flow.tech/review/x'});
  assert.deepEqual(origin.canonicalHostDecision('scopeflow-qnng.onrender.com', '/.well-known/oauth-protected-resource', '', env), {action: 'redirect', location: 'https://scope-flow.tech/.well-known/oauth-protected-resource'});
  assert.deepEqual(origin.canonicalHostDecision('scopeflow-qnng.onrender.com', '/oauth/authorize', '?client_id=a', env), {action: 'redirect', location: 'https://scope-flow.tech/oauth/authorize?client_id=a'});
  assert.equal(origin.canonicalHostDecision('scopeflow-qnng.onrender.com', '/api/scopes', '', env).action, 'misdirected');
  assert.equal(origin.canonicalHostDecision('scopeflow-qnng.onrender.com', '/mcp', '', env).action, 'misdirected');
  assert.equal(origin.canonicalHostDecision('scopeflow-qnng.onrender.com', '/oauth/token', '', env).action, 'misdirected');
  for (const path of ['/api/health', '/api/readiness', '/api/payments/razorpay/webhook', '/api/inbound/email', '/api/heads/2026-10-01']) assert.equal(origin.canonicalHostDecision('scopeflow-qnng.onrender.com', path, '', env).action, 'next', path);
  for (const host of ['scope-flow.tech', 'SCOPE-FLOW.TECH', 'localhost:10000', '10.0.0.5:10000', 'srv-abc123', '[::1]:3000', null, '']) assert.equal(origin.canonicalHostDecision(host, '/review/x', '', env).action, 'next', String(host));
  assert.equal(origin.canonicalHostDecision('scopeflow-qnng.onrender.com', '/review/x', '', {}).action, 'next', 'no APP_URL: no redirect');
  fc.assert(fc.property(fc.domain().filter(d => d !== 'scope-flow.tech' && d.includes('.')), fc.webPath(), (host, path) => {
    const p = path.startsWith('/') ? path : '/' + path;
    const d = origin.canonicalHostDecision(host, p, '', env);
    if (d.action === 'redirect') assert.ok(d.location.startsWith('https://scope-flow.tech/'));
    if (d.action === 'misdirected') assert.ok(d.canonical.startsWith('https://scope-flow.tech/'));
  }));
});

// @covers M26
test('in-memory read limiter: exact sliding window, independent keys, bounded memory', () => {
  const l = memoryLimiter();
  const t0 = 1_000_000;
  let allowed = 0;
  for (let i = 0; i < 330; i++) if (l.allow('k', 300, t0 + i * 10)) allowed++;
  assert.equal(allowed, 300);
  assert.ok(l.retryAfter('k', 300, t0 + 3300) >= 1);
  assert.equal(l.allow('other', 300, t0 + 3300), true, 'another key is unaffected');
  assert.equal(l.allow('k', 300, t0 + 60_000), true, 'the oldest hit leaves the window after 60 s');
  const small = memoryLimiter({maxKeys: 100});
  for (let i = 0; i < 1000; i++) small.allow('key' + i, 5, t0);
  assert.ok(small.size() <= 100);
  fc.assert(fc.property(fc.array(fc.nat(120_000), {minLength: 1, maxLength: 200}), fc.integer({min: 1, max: 20}), (offsets, limit) => {
    const times = [...offsets].sort((a, b) => a - b), lim = memoryLimiter(), accepted = [];
    for (const t of times) if (lim.allow('x', limit, t)) accepted.push(t);
    // Never more than `limit` accepted hits in any 60-second window.
    for (let i = 0; i < accepted.length; i++) assert.ok(accepted.filter(t => t > accepted[i] - 60_000 && t <= accepted[i]).length <= limit);
  }));
});

// @covers M27
test('getUser is looked up once per request (spy), fresh answers cached, cached never answers fresh', async () => {
  const memo = requestMemo();
  const calls = [];
  const lookup = async mode => { calls.push(mode); return {userId: 'u1'}; };
  const requestA = {}, requestB = {};
  // One request (the review GET): the owner check and the read path both ask.
  await Promise.all([memo(requestA, 'fresh', lookup), memo(requestA, 'fresh', lookup), memo(requestA, 'cached', lookup)]);
  assert.deepEqual(calls, ['fresh']);
  await memo(requestB, 'cached', lookup);
  await memo(requestB, 'cached', lookup);
  assert.deepEqual(calls, ['fresh', 'cached']);
  await memo(requestB, 'fresh', lookup);
  assert.deepEqual(calls, ['fresh', 'cached', 'fresh'], 'a cached read never stands in for a fresh check');
  // Outside a request there is nothing to key on: every call looks up.
  await memo(null, 'fresh', lookup); await memo(null, 'fresh', lookup);
  assert.equal(calls.length, 5);
  // A failed lookup is retried on the next call in the same request.
  const failing = requestMemo(); let n = 0;
  const key = {};
  await assert.rejects(failing(key, 'fresh', async () => { n++; throw new Error('neon down'); }));
  await failing(key, 'fresh', async () => { n++; return null; });
  assert.equal(n, 2);
});

// @covers M28
test('a handler that throws TypeError gets 500 with an error id, not a 503 "try again"', async () => {
  const logged = [];
  const r = errors.errorResponse(new TypeError("Cannot read properties of undefined (reading 'x')"), (id, e) => logged.push([id, e]));
  assert.equal(r.status, 500);
  const body = await r.json();
  assert.match(body.error_id, /^err_[0-9a-f]{16}$/);
  assert.equal(body.code, 'internal_error');
  assert.ok(body.error.includes(body.error_id));
  assert.equal(logged.length, 1); assert.equal(logged[0][0], body.error_id);
  assert.equal(r.headers.get('cache-control'), 'no-store');
});

// @covers M28 LT-06
test('error taxonomy: typed errors, bad input, races, final records, dependency outages', async () => {
  const status = e => errors.errorResponse(e, () => {}).status;
  assert.equal(status(new errors.ValidationError({title: 'Use at least 3 characters'})), 400);
  assert.equal(status(new errors.Forbidden('session_required')), 403);
  assert.equal(status(new errors.Conflict('exceeds_uninvoiced')), 409);
  assert.equal(status(new errors.RateLimited(30)), 429);
  assert.equal(status(new errors.Unavailable('signing')), 503);
  const invalid = Object.assign(new Error('x'), {name: 'InvalidInputError'});
  assert.equal(status(invalid), 400);
  assert.equal(status(new Error('UNIQUE constraint violation', {cause: Object.assign(new Error('dup'), {code: '23505'})})), 409);
  assert.equal(status(Object.assign(new Error('scopeflow: a recorded decision is immutable'), {code: 'P0001'})), 409);
  assert.equal(status(Object.assign(new Error('fictional test failure'), {code: 'P0001'})), 500, 'only Scopeflow guards are 409');
  for (const code of ['ECONNREFUSED', '57P01', '53300', '08006']) assert.equal(status(Object.assign(new Error('down'), {code})), 503, code);
  assert.equal(status(new Error('timeout exceeded when trying to connect')), 503);
  for (const e of [new RangeError('x'), new SyntaxError('x'), new Error('boom'), 'a string', null, undefined]) assert.equal(status(e), 500);
  const db = await errors.errorResponse(Object.assign(new Error('down'), {code: 'ECONNREFUSED'})).json();
  assert.deepEqual([db.code, db.dependency], ['unavailable', 'database']);
  // LT-06 support: zod issues become field messages with human labels, never raw schema keys.
  const fields = errors.fieldErrors([{path: ['title'], code: 'too_small', type: 'string', minimum: 3, message: 'String must contain at least 3 character(s)'}, {path: ['client'], code: 'invalid_type', message: 'Required'}, {path: ['items', 0, 'title'], message: 'Invalid input'}], {title: 'Title', client: 'Client'});
  assert.deepEqual(fields, {title: 'Title: use at least 3 characters.', client: 'Client is required.', 'items.0.title': 'Check items.'});
  const v = errors.validationFromZod([{path: ['fee'], message: 'Use at most 2 decimals'}]);
  const r = errors.errorResponse(v);
  assert.equal(r.status, 400);
  assert.deepEqual((await r.json()).fields, {fee: 'Use at most 2 decimals'});
});

test('envelope encryption: round trip, row binding, tamper detection, key rotation', () => {
  const k1 = Buffer.alloc(32, 1).toString('base64'), k2 = Buffer.alloc(32, 2).toString('base64');
  const env1 = {SCOPEFLOW_ENCRYPTION_KEY: k1};
  fc.assert(fc.property(fc.string({maxLength: 200}), fc.string({minLength: 1, maxLength: 40}), (secret, aad) => {
    const sealed = box.seal(secret, aad, env1);
    assert.ok(box.isBox(sealed));
    assert.ok(!sealed.includes(Buffer.from(secret).toString('base64url')) || secret.length < 4);
    assert.equal(box.open(sealed, aad, env1), secret);
    assert.throws(() => box.open(sealed, aad + 'x', env1), box.CryptoBoxError);
  }), {numRuns: 50});
  const sealed = box.seal('rzp_live_secret', 'payment_accounts:a1:key_secret', env1);
  const parts = sealed.split('.');
  const flipped = parts[4].slice(0, -2) + (parts[4].at(-2) === 'A' ? 'B' : 'A') + parts[4].at(-1);
  assert.throws(() => box.open([...parts.slice(0, 4), flipped].join('.'), 'payment_accounts:a1:key_secret', env1), box.CryptoBoxError);
  // Rotation: the new key reads old boxes through _PREVIOUS; rewrap moves them to the new key.
  const env2 = {SCOPEFLOW_ENCRYPTION_KEY: k2, SCOPEFLOW_ENCRYPTION_KEY_PREVIOUS: k1};
  assert.equal(box.open(sealed, 'payment_accounts:a1:key_secret', env2), 'rzp_live_secret');
  const moved = box.rewrap(sealed, 'payment_accounts:a1:key_secret', env2);
  assert.notEqual(moved.split('.')[1], sealed.split('.')[1]);
  assert.equal(box.open(moved, 'payment_accounts:a1:key_secret', {SCOPEFLOW_ENCRYPTION_KEY: k2}), 'rzp_live_secret');
  assert.throws(() => box.open(sealed, 'payment_accounts:a1:key_secret', {SCOPEFLOW_ENCRYPTION_KEY: k2}), /not configured/);
  assert.throws(() => box.seal('x', 'a', {}), /SCOPEFLOW_ENCRYPTION_KEY/);
  assert.throws(() => box.seal('x', 'a', {SCOPEFLOW_ENCRYPTION_KEY: 'short'}), /32 bytes/);
  assert.equal(box.encryptionConfigured({}), false);
  assert.equal(box.encryptionConfigured(env1), true);
});

// @covers SF-14
test('analytics export never carries an email, IP, phone or free text', () => {
  const props = analytics.safeProps({version: 2, outcome: 'approved', seq: 3, email: 'ada@example.com', ip: '203.0.113.9', signer: 'Ada Lovelace', note: 'call me on +919876543210', actor: 'ada@example.com'});
  assert.deepEqual(props, {version: 2, outcome: 'approved', seq: 3});
  const batch = analytics.posthogBatch([{id: 1, event: 'decision', owner: 'owner-123', project_id: 'proj-1', props: {version: 1, outcome: 'approved'}, created: '2026-10-07T09:00:00.000Z'}], 'phc_test', {SCOPEFLOW_ANALYTICS_SALT: 's'});
  const text = JSON.stringify(batch);
  assert.ok(!text.includes('owner-123') && !text.includes('proj-1'), 'account and project ids are hashed');
  assert.equal(batch.batch[0].event, 'scopeflow_decision');
  assert.equal(batch.batch[0].properties.$ip, null);
  fc.assert(fc.property(fc.dictionary(fc.string({maxLength: 12}), fc.oneof(fc.emailAddress(), fc.ipV4(), fc.ipV6(), fc.string(), fc.integer())), d => {
    for (const v of Object.values(analytics.safeProps(d))) assert.ok(typeof v === 'number' || (!String(v).includes('@') && !/\d+\.\d+\.\d+\.\d+/.test(String(v))));
  }));
  assert.equal(analytics.analyticsEnabled({SCOPEFLOW_ANALYTICS: 'off'}), false);
  assert.equal(analytics.posthogConfig({POSTHOG_KEY: 'phc', SCOPEFLOW_ANALYTICS: 'off'}), null);
  assert.equal(analytics.posthogConfig({POSTHOG_KEY: 'phc'}).host, 'https://eu.i.posthog.com');
});
