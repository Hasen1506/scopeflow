// Live signed-in UX test fixes: deposit vs payment schedule (B-2), new-project time zone (B-5),
// review-page decision failure (B-1/#59), clipboard success only after the write (C28), and no raw
// env var names in user-facing copy (B-4). Seeded, no network.
import '../support/fc-setup.mjs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, readdirSync, statSync} from 'node:fs';
import {join} from 'node:path';
import {fc} from '../support/property.mjs';

const {scopeSchema, blank, hasDepositScheduleConflict, DEPOSIT_SCHEDULE_CONFLICT} = await import('../../lib/scope.ts');
const {fieldErrors, validationBanner} = await import('../../lib/editor.ts');
const {newProjectZone} = await import('../../lib/time.ts');
const {copyText} = await import('../../lib/clipboard.ts');
const {decisionUnavailable, tellSenderHref, DECISION_COOLDOWN_S} = await import('../../app/review/[token]/states.ts');
const {llmStatus} = await import('../../lib/llm.ts');

const base = {...blank, title: 'Website refresh', client: 'Northwind', items: [{id: 'i1', title: 'Homepage', qty: 1, unit: '', price: null, acceptance: ''}], deliverables: '', fee: 1000};
const ms = [{id: 'm1', title: 'On signature', pct: 50, due: ''}, {id: 'm2', title: 'On delivery', pct: 50, due: ''}];

test('B-2: a deposit plus milestones is the named conflict, reported first, and the banner names it', () => {
  assert.equal(hasDepositScheduleConflict({deposit_pct: 30, milestones: ms}), true);
  assert.equal(hasDepositScheduleConflict({deposit_pct: 30}), false);
  assert.equal(hasDepositScheduleConflict({deposit_pct: 0, milestones: ms}), false);
  assert.equal(hasDepositScheduleConflict({milestones: []}), false);
  const r = scopeSchema.safeParse({...base, deposit_pct: 30, milestones: ms});
  assert.equal(r.success, false);
  const f = fieldErrors(r.error.issues);
  assert.equal(f.milestones, DEPOSIT_SCHEDULE_CONFLICT);
  const banner = validationBanner(f, DEPOSIT_SCHEDULE_CONFLICT);
  assert.match(banner, /Payment schedule\./);
  assert.match(banner, /Clear the deposit/);
  // Clearing the deposit is the whole fix.
  assert.equal(scopeSchema.safeParse({...base, milestones: ms}).success, true);
  // Without a cross-field problem the banner is unchanged.
  assert.equal(validationBanner({title: 'x'}), 'Check the highlighted fields: Project name.');
});

test('B-2: the conflict is first even when the milestones also miss 100%', () => {
  const r = scopeSchema.safeParse({...base, deposit_pct: 20, milestones: [{id: 'm1', title: 'Start', pct: 40, due: ''}]});
  assert.equal(fieldErrors(r.error.issues).milestones, DEPOSIT_SCHEDULE_CONFLICT);
});

test('B-5: a new project starts in the account zone, else the browser zone, else none (UTC)', () => {
  assert.equal(newProjectZone('Asia/Kolkata', 'UTC'), 'Asia/Kolkata');
  assert.equal(newProjectZone(null, 'Europe/London'), 'Europe/London');
  assert.equal(newProjectZone('Not/AZone', 'America/New_York'), 'America/New_York');
  assert.equal(newProjectZone(undefined, 'nonsense'), null);
  fc.assert(fc.property(fc.string(), fc.string(), (a, b) => { const z = newProjectZone(a, b); return z === null || z === a || z === b; }));
});

test('B-1/#59: only "could not record right now" failures rest the buttons', () => {
  assert.equal(decisionUnavailable({status: 503, code: 'signing_unavailable'}), true);
  assert.equal(decisionUnavailable({status: 500}), true);
  assert.equal(decisionUnavailable(new TypeError('Failed to fetch')), true);
  assert.equal(decisionUnavailable({status: 409, code: 'stale'}), false);
  assert.equal(decisionUnavailable({status: 400}), false);
  assert.equal(decisionUnavailable({status: 429}), false);
  assert.ok(DECISION_COOLDOWN_S >= 10 && DECISION_COOLDOWN_S <= 120);
  const t = (k, v = {}) => k + JSON.stringify(v);
  const href = tellSenderHref(t, 2, 'https://x.test/review/abc', 'Please add a page');
  assert.match(href, /^mailto:\?subject=/);
  const body = new URLSearchParams(href.slice('mailto:?'.length)).get('body');
  assert.match(body, /review\/abc/);
  assert.match(body, /Please add a page/);
});

test('UX-C28: copyText reports success only after the write settles', async () => {
  assert.equal(await copyText('x', {writeText: async () => {}}), true);
  assert.equal(await copyText('x', {writeText: async () => { throw new Error('denied'); }}), false);
  assert.equal(await copyText('x', undefined), false);
  assert.equal(await copyText('x', null), false);
});

test('B-4: AI status reason names no env var', () => {
  assert.doesNotMatch(llmStatus({}).reason, /_API_KEY|OPENAI|ANTHROPIC/);
});

test('B-4: client components never show raw env var names', () => {
  const root = new URL('../../app/', import.meta.url).pathname;
  const files = [];
  const walk = d => { for (const n of readdirSync(d)) { const p = join(d, n); if (statSync(p).isDirectory()) { if (n !== 'api') walk(p); } else if (p.endsWith('.tsx')) files.push(p); } };
  walk(root);
  const ENV = /\b(SCOPEFLOW_INBOUND_[A-Z_]+|OPENAI_API_KEY|ANTHROPIC_API_KEY|RAZORPAY_[A-Z_]+|STRIPE_[A-Z_]+)\b/;
  const offenders = files.filter(p => {
    const src = readFileSync(p, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/process\.env\.[A-Z_]+/g, '');
    return ENV.test(src);
  });
  assert.deepEqual(offenders.map(p => p.slice(root.length)), []);
});
