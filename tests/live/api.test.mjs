// Live API properties against the local production build:
//  * a review-link token never grants an owner action, however it is presented;
//  * foreign Origins are rejected on every state-changing route and change nothing;
//  * fuzzed input never produces a 5xx (no 500/503 from validation gaps).
import {test, before, after} from 'node:test';
import assert from 'node:assert/strict';
import {fc} from '../support/property.mjs';
import {base, call, database, owner, project, decide, changeOrder} from './support.mjs';

let db, A, F, approved, pending, revoked;
const clearLimits = () => db.query('DELETE FROM scopeflow.rate_limits');
async function snapshot(ownerId) {
  const r = await db.query(`SELECT
    (SELECT count(*) FROM scopeflow.projects WHERE owner=$1) AS projects,
    (SELECT count(*) FROM scopeflow.projects WHERE owner=$1 AND archived IS NOT NULL) AS archived,
    (SELECT count(*) FROM scopeflow.projects WHERE owner=$1 AND client_email IS NOT NULL) AS emails,
    (SELECT count(*) FROM scopeflow.versions v JOIN scopeflow.projects p ON p.id=v.project_id WHERE p.owner=$1) AS versions,
    (SELECT count(*) FROM scopeflow.versions v JOIN scopeflow.projects p ON p.id=v.project_id WHERE p.owner=$1 AND v.revoked=1) AS revoked,
    (SELECT string_agg(v.token, ',' ORDER BY v.id) FROM scopeflow.versions v JOIN scopeflow.projects p ON p.id=v.project_id WHERE p.owner=$1) AS tokens,
    (SELECT count(*) FROM scopeflow.ledger_entries e JOIN scopeflow.projects p ON p.id=e.project_id WHERE p.owner=$1) AS entries,
    (SELECT count(*) FROM scopeflow.api_keys WHERE owner=$1) AS keys`, [ownerId]);
  return r.rows[0];
}

before(async () => {
  db = await database();
  A = await owner('prop-api-owner');
  F = await owner('prop-api-fuzz');
  await clearLimits();
  approved = await project(A, 'Approved baseline', {approve: true});
  await changeOrder(A, approved.project_id, 400);
  pending = await project(A, 'Pending draft');
  revoked = await project(A, 'Revoked link');
  const r = await call(`/api/scopes/${revoked.project_id}/review-link`, {method: 'POST', cookie: A.cookie, body: {version: 1, action: 'revoke'}});
  assert.equal(r.status, 200);
  const owners = await db.query('SELECT DISTINCT owner FROM scopeflow.projects WHERE id = ANY($1)', [[approved.project_id, pending.project_id]]);
  A.id = owners.rows[0].owner;
});
after(async () => { await db.end(); });

// Every owner route, with a body that would succeed for the owner.
const ownerRoutes = () => [
  ['GET', '/api/scopes'], ['POST', '/api/scopes', {title: 'Token tries to create', client: 'Someone', deliverables: 'A thing to make', exclusions: '', fee: 1, currency: 'USD', revisions: 1, due: '', notes: ''}],
  ['GET', `/api/scopes/${approved.project_id}`], ['POST', `/api/scopes/${pending.project_id}`, {expected_version: 1, content: {title: 'Token tries to revise', client: 'Someone', deliverables: 'A thing to make', exclusions: '', fee: 1, currency: 'USD', revisions: 1, due: '', notes: ''}}],
  ['PATCH', `/api/scopes/${approved.project_id}`, {archived: true}], ['PATCH', `/api/scopes/${approved.project_id}`, {client_email: 'attacker@example.test'}],
  ['DELETE', `/api/scopes/${pending.project_id}`, {confirmation: 'DELETE'}],
  ['GET', `/api/scopes/${approved.project_id}/ledger`], ['POST', `/api/scopes/${approved.project_id}/ledger`, {kind: 'goodwill', baseline_version: 1, payload: {title: 'Token goodwill', value: 1}}],
  ['POST', `/api/scopes/${approved.project_id}/ledger`, {kind: 'settle', baseline_version: 1, payload: {ref_seq: 1, outcome: 'withdrawn'}}],
  ['POST', `/api/scopes/${pending.project_id}/review-link`, {version: 1, action: 'rotate'}], ['POST', `/api/scopes/${revoked.project_id}/review-link`, {version: 1, action: 'rotate'}],
  ['GET', `/api/scopes/${pending.project_id}/send`], ['POST', `/api/scopes/${pending.project_id}/send`, {version: 1, email: 'attacker@example.test'}],
  ['GET', `/api/scopes/${approved.project_id}/export`], ['GET', '/api/account'], ['DELETE', '/api/account', {confirmation: 'DELETE'}],
  ['GET', '/api/key'], ['POST', '/api/key', {}], ['DELETE', '/api/key'], ['GET', '/api/insights'],
];
const carriers = {
  bearer: t => ({headers: {Authorization: 'Bearer ' + t}}),
  cookie: t => ({headers: {cookie: `__Secure-neon-auth.session_token=${t}; neon-auth.session_token=${t}`}}),
  query: t => ({query: '?token=' + t}),
  header: t => ({headers: {'X-Review-Token': t, 'X-Scopeflow-Token': t}}),
  referer: t => ({headers: {Referer: `${base}/review/${t}`}}),
};

test('a review-link token never grants an owner action', async () => {
  const before = await snapshot(A.id);
  const routes = ownerRoutes();
  const tokens = [approved.token, pending.token, revoked.token];
  await fc.assert(fc.asyncProperty(fc.integer({min: 0, max: routes.length - 1}), fc.constantFrom(...Object.keys(carriers)), fc.integer({min: 0, max: tokens.length - 1}), fc.boolean(), async (r, c, t, withOrigin) => {
    const [method, path, body] = routes[r];
    const how = carriers[c](tokens[t]);
    await clearLimits();
    const res = await call(path + (how.query ?? ''), {method, body, headers: {...(how.headers ?? {}), ...(withOrigin ? {Origin: base} : {})}});
    assert.ok([400, 401, 403, 404, 405, 415].includes(res.status), `${c} token on ${method} ${path} → ${res.status} ${JSON.stringify(res.json).slice(0, 200)}`);
    assert.ok(!JSON.stringify(res.json).match(/[a-f0-9]{64}/), 'no token or hash leaked');
  }), {numRuns: 150});
  assert.deepEqual(await snapshot(A.id), before, 'nothing changed');
});

test('a review-link token can only settle change orders: client-side entries are always settles', async () => {
  const kinds = fc.constantFrom('change_order', 'goodwill', 'revision_round', 'client_input', 'settle');
  await fc.assert(fc.asyncProperty(kinds, fc.jsonValue({maxDepth: 2}), fc.constantFrom('withdrawn', 'approved', 'declined', 'proposed'), async (kind, junk, outcome) => {
    await clearLimits();
    const res = await call(`/api/review/${approved.token}/change-order`, {method: 'POST', body: {kind, seq: 999, decision: outcome, signer: 'Fictional Client', comment: 'x', payload: junk}});
    assert.ok(res.status < 500 && res.status !== 200 && res.status !== 201, `${res.status}`);
  }), {numRuns: 40});
  const rows = await db.query(`SELECT kind FROM scopeflow.ledger_entries WHERE actor='client'`);
  assert.ok(rows.rows.every(r => r.kind === 'settle'));
  // A token for one project never settles another project's change order.
  const other = await project(A, 'Other approved', {approve: true});
  await changeOrder(A, other.project_id, 100);
  const seq = await changeOrder(A, other.project_id, 200, 'Second change');
  const mine = await call(`/api/scopes/${approved.project_id}/ledger`, {cookie: A.cookie});
  assert.ok(!mine.json.entries.some(e => e.seq === seq), 'the token\'s own ledger has no entry with that number');
  await clearLimits();
  const res = await call(`/api/review/${approved.token}/change-order`, {method: 'POST', body: {seq, decision: 'approved', signer: 'Fictional Client', comment: ''}});
  assert.equal(res.status, 409, JSON.stringify(res.json));
  const ledger = await call(`/api/scopes/${other.project_id}/ledger`, {cookie: A.cookie});
  assert.equal(ledger.json.agreement.pending, 2);
});

const foreignOrigin = fc.oneof(
  fc.tuple(fc.constantFrom('http', 'https'), fc.domain(), fc.option(fc.integer({min: 1, max: 65535}), {nil: null})).map(([s, h, p]) => `${s}://${h}${p ? ':' + p : ''}`),
  fc.constantFrom('null', 'http://localhost:5174', 'https://localhost:5173', 'http://127.0.0.1:5173', 'http://localhost.evil.test:5173', 'http://evil.test'),
).filter(o => o !== base);

test('foreign Origins are rejected on every state-changing route and change nothing', async () => {
  const before = await snapshot(A.id);
  const routes = ownerRoutes().filter(([m]) => m !== 'GET');
  const review = [['POST', `/api/review/${pending.token}`, {decision: 'approved', signer: 'Forged', comment: '', version: 1, acknowledged: true, content_sha256: '0'.repeat(64)}], ['POST', `/api/review/${approved.token}/change-order`, {seq: 1, decision: 'approved', signer: 'Forged', comment: ''}]];
  const all = [...routes, ...review];
  await fc.assert(fc.asyncProperty(fc.integer({min: 0, max: all.length - 1}), foreignOrigin, async (r, origin) => {
    const [method, path, body] = all[r];
    await clearLimits();
    const res = await call(path, {method, body, cookie: A.cookie, headers: {Origin: origin}});
    assert.equal(res.status, 403, `${origin} on ${method} ${path} → ${res.status}`);
  }), {numRuns: 120});
  // Cross-site fetch metadata alone is also refused for destructive routes.
  await clearLimits();
  assert.equal((await call(`/api/scopes/${pending.project_id}`, {method: 'DELETE', cookie: A.cookie, body: {confirmation: 'DELETE'}, headers: {Origin: base, 'Sec-Fetch-Site': 'cross-site'}})).status, 403);
  assert.deepEqual(await snapshot(A.id), before, 'nothing changed');
});

// ---------------------------------------------------------------------------
// Fuzzing: structured near-valid payloads and arbitrary JSON, on every route.
// ---------------------------------------------------------------------------
const nasty = fc.oneof(
  fc.string(), fc.string({unit: 'binary', maxLength: 30}), fc.constantFrom('\u0000', 'a\u0000b', '\uD800', '%00', '../../etc', '<script>', "'; DROP TABLE x;--", '?', '$1', 'x'.repeat(5000)),
);
const nastyNumber = fc.oneof(fc.integer(), fc.double(), fc.constantFrom(0, -1, 2 ** 31, 2 ** 31 - 1, -(2 ** 31) - 1, 2 ** 53, 1e308, -0, 0.1, 99.999));
const nastyValue = fc.oneof(nasty, nastyNumber, fc.boolean(), fc.constant(null), fc.jsonValue({maxDepth: 2}));
const scopeLike = fc.record({title: nastyValue, client: nastyValue, deliverables: nastyValue, items: fc.oneof(nastyValue, fc.array(fc.record({id: nastyValue, title: nastyValue, qty: nastyNumber, price: nastyValue}, {requiredKeys: []}), {maxLength: 3})), exclusions: nastyValue, fee: nastyNumber, currency: fc.oneof(fc.constantFrom('USD', 'EUR'), nasty), revisions: nastyNumber, due: fc.oneof(nasty, fc.constantFrom('2027-02-29', '2026-13-01', '0000-00-00', '9999-12-31')), notes: nastyValue}, {requiredKeys: []});
// Valid payloads with exactly one field replaced: reaches the deep code paths (storage,
// hashing, ledger folding) that wholly random JSON never gets past validation to.
const validScope = {title: 'Fuzzed scope', client: 'Fuzz client', deliverables: '', items: [{id: 'a', title: 'Logo'}], exclusions: '', fee: 100, currency: 'USD', revisions: 1, due: '', notes: ''};
const oneOff = (valid, keys, value = nastyValue) => fc.tuple(fc.constantFrom(...keys), value).map(([k, v]) => ({...valid, [k]: v}));
const validCo = {title: 'Fuzzed change', add_items: [{id: 'fz', title: 'Fuzz item'}], fee_delta: 10};
const bodies = {
  scope: fc.oneof(scopeLike, oneOff(validScope, Object.keys(validScope)), oneOff(validScope, ['title', 'client', 'notes', 'exclusions'], nasty)),
  revision: fc.oneof(fc.record({expected_version: nastyNumber, content: scopeLike, supersede_agreement: nastyValue}, {requiredKeys: []}), oneOff(validScope, Object.keys(validScope)).map(content => ({expected_version: 1, content}))),
  patch: fc.record({archived: nastyValue, client_email: fc.oneof(fc.emailAddress(), nasty)}, {requiredKeys: []}),
  ledger: fc.oneof(
    oneOff(validCo, ['title', 'reason', 'request_quote', 'add_items', 'remove_item_ids', 'fee_delta', 'days_delta', 'revisions_delta']).map(payload => ({kind: 'change_order', baseline_version: 1, payload})),
    fc.record({title: nasty, value: nastyNumber, hours: nastyNumber, note: nasty, visible: fc.boolean()}).map(payload => ({kind: 'goodwill', baseline_version: 1, payload})),
    fc.record({feedback_date: fc.oneof(nasty, fc.constantFrom('2026-10-08', '2027-02-29')), note: nasty}).map(payload => ({kind: 'revision_round', baseline_version: 1, payload, request_id: 'fuzz-request-0001'})),
    fc.record({kind: fc.oneof(fc.constantFrom('change_order', 'goodwill', 'revision_round', 'client_input', 'settle'), nasty), baseline_version: nastyNumber, request_id: nasty, payload: fc.oneof(nastyValue, fc.record({title: nastyValue, fee_delta: nastyNumber, days_delta: nastyNumber, revisions_delta: nastyNumber, add_items: nastyValue, remove_item_ids: nastyValue, ref_seq: nastyNumber, outcome: nastyValue, value: nastyNumber, feedback_date: nasty, input_id: nasty, received: nasty}, {requiredKeys: []}))}, {requiredKeys: []})),
  review: fc.record({decision: fc.oneof(fc.constantFrom('approved', 'changes_requested'), nasty), signer: nasty, comment: nasty, version: nastyNumber, acknowledged: nastyValue, content_sha256: fc.oneof(nasty, fc.stringMatching(/^[a-f0-9]{64}$/))}, {requiredKeys: []}),
  settle: fc.record({seq: nastyNumber, decision: fc.oneof(fc.constantFrom('approved', 'declined'), nasty), signer: nasty, comment: nasty}, {requiredKeys: []}),
  link: fc.record({version: nastyNumber, action: fc.oneof(fc.constantFrom('revoke', 'rotate'), nasty)}, {requiredKeys: []}),
  send: fc.record({version: nastyNumber, email: fc.oneof(fc.emailAddress(), nasty)}, {requiredKeys: []}),
  any: fc.jsonValue({maxDepth: 3}),
};
const raw = fc.oneof(fc.string(), fc.constantFrom('', '{', '[]', 'null', '{"a":', '\u0000', '{"title":"\\u0000"}', JSON.stringify({x: 'y'.repeat(30000)})));
const segment = fc.oneof(fc.string({maxLength: 80}), fc.constantFrom('%00', 'a%00b', '%2e%2e', '%E0%A4%A', '..', 'x'.repeat(500), '0'.repeat(64), 'f'.repeat(64), "'"), fc.stringMatching(/^[a-f0-9]{64}$/)).map(s => encodeURIComponent(s).replace(/%25(00|2e|E0)/gi, '%$1'));

test('fuzzed input never produces a 5xx', async t => {
  // A dedicated owner, so fuzzing cannot disturb the other properties' fixtures.
  const fp = await project(F, 'Fuzz approved', {approve: true});
  const fq = await project(F, 'Fuzz pending');
  const targets = [
    ['POST', () => '/api/scopes', 'scope'], ['POST', () => `/api/scopes/${fq.project_id}`, 'revision'], ['POST', () => `/api/scopes/${fp.project_id}`, 'revision'],
    ['PATCH', () => `/api/scopes/${fq.project_id}`, 'patch'], ['DELETE', () => `/api/scopes/${fq.project_id}`, 'any'],
    ['POST', () => `/api/scopes/${fp.project_id}/ledger`, 'ledger'], ['POST', () => `/api/review/${fq.token}`, 'review'], ['POST', () => `/api/review/${fp.token}/change-order`, 'settle'],
    ['POST', () => `/api/scopes/${fq.project_id}/review-link`, 'link'], ['POST', () => `/api/scopes/${fq.project_id}/send`, 'send'],
    ['POST', s => `/api/scopes/${s}`, 'revision'], ['GET', s => `/api/scopes/${s}`], ['GET', s => `/api/scopes/${s}/ledger`], ['POST', s => `/api/scopes/${s}/ledger`, 'ledger'],
    ['GET', s => `/api/scopes/${s}/export`], ['PATCH', s => `/api/scopes/${s}`, 'patch'], ['DELETE', s => `/api/scopes/${s}`, 'any'], ['POST', s => `/api/scopes/${s}/review-link`, 'link'], ['POST', s => `/api/scopes/${s}/send`, 'send'],
    ['GET', s => `/api/review/${s}`], ['POST', s => `/api/review/${s}`, 'review'], ['POST', s => `/api/review/${s}/change-order`, 'settle'],
  ];
  const statuses = {};
  const input = fc.integer({min: 0, max: targets.length - 1}).chain(i => fc.record({
    i: fc.constant(i), seg: segment,
    body: targets[i][0] === 'GET' ? fc.constant(undefined) : bodies[targets[i][2] ?? 'any'],
    raw: targets[i][0] === 'GET' ? fc.constant(null) : fc.option(raw, {nil: null, freq: 4}),
  }));
  await fc.assert(fc.asyncProperty(input, async ({i, seg, body, raw: rawBody}) => {
    const [method, path] = targets[i];
    await clearLimits();
    const res = await call(path(seg), {method, cookie: F.cookie, ...(rawBody !== null ? {raw: rawBody} : {body})});
    statuses[res.status] = (statuses[res.status] ?? 0) + 1;
    assert.ok(res.status < 500, `${method} ${path(seg)} ${rawBody !== null ? 'raw ' + JSON.stringify(rawBody).slice(0, 200) : JSON.stringify(body)?.slice(0, 300)} → ${res.status} ${JSON.stringify(res.json).slice(0, 200)}`);
  }), {numRuns: Number(process.env.FUZZ_RUNS ?? 400)});
  t.diagnostic('status histogram ' + JSON.stringify(statuses));
});

// The concrete cases the fuzzer found (each returned 500/503 before this suite), pinned.
test('regressions: NUL characters, int4 overflow and malformed URL encoding are 400s', async () => {
  const fq = await project(F, 'Regression pending');
  const view = await call('/api/review/' + fq.token);
  const {createHash} = await import('node:crypto');
  const content_sha256 = createHash('sha256').update(JSON.stringify(view.json.scope.content)).digest('hex');
  const cases = [
    ['POST', `/api/scopes/${fq.project_id}/review-link`, {version: 2 ** 40, action: 'revoke'}],
    ['POST', `/api/scopes/${fq.project_id}/send`, {version: 2 ** 31, email: 'client@example.test'}],
    ['GET', '/api/scopes/a%00b'], ['GET', '/api/scopes/a%00b/ledger'], ['GET', '/api/scopes/a%00b/export'],
    ['POST', `/api/review/${fq.token}`, {decision: 'changes_requested', signer: 'Ad\u0000a', comment: 'x\u0000', version: 1, acknowledged: true, content_sha256}],
    ['GET', '/api/scopes/%E0'], ['GET', '/api/review/%E0%A4%A'], ['POST', '/api/review/%E0/change-order', {}], ['GET', '/review/%E0'],
  ];
  for (const [method, path, body] of cases) {
    await clearLimits();
    const res = await call(path, {method, body, cookie: F.cookie});
    assert.equal(res.status, 400, `${method} ${path} → ${res.status} ${JSON.stringify(res.json).slice(0, 150)}`);
  }
  // The NUL-signer decision was refused, so the version is still pending and can be approved.
  assert.equal((await call('/api/review/' + fq.token)).json.scope.status, 'pending');
});
