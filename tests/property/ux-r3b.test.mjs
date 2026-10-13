// UX round 3b (reaudit3.md): honest /plans copy (R3-03, R3-16), the deposit's received day on the client
// page (R3-04), unit prices in the API and MCP schemas (R3-10), and small copy and a11y fixes (R3-05..R3-17,
// visual #11/#15/#20/#29/#30, C11/C13/C24). Seeded, no network.
import '../support/fc-setup.mjs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fc} from '../support/property.mjs';

const P = await import('../../lib/plans.ts');
const {depositPaidWhen} = await import('../../lib/deposit-paid.ts');
const {lineTotal} = await import('../../lib/money.ts');
const {itemSchema} = await import('../../lib/scope.ts');
const {authProblem} = await import('../../lib/auth/problem.ts');
const {countryFromLocale} = await import('../../lib/profile.ts');
const {STAGE_LABEL} = await import('../../lib/stage.ts');
const {label} = await import('../../lib/scope.ts');
const read = rel => readFileSync(new URL('../../' + rel, import.meta.url), 'utf8');

test('R3-03: plan cards list only enforced limits; shared features are said once; unbuilt ones are coming soon', () => {
  const cards = P.planCards('INR', n => '₹' + n);
  for (const c of cards) {
    const l = P.PLANS[c.id].limits;
    assert.deepEqual(c.lines, [P.projectCapLine(l), `${l.versions} versions per project`, `${l.ledger_entries.toLocaleString('en-IN')} record entries per project`], c.id);
    // Nothing every plan has is sold as a plan difference.
    for (const f of P.ALL_PLANS_INCLUDE) assert.ok(!c.lines.includes(f), `${c.id} repeats "${f}"`);
  }
  // No plan feature is gated today, so no shown plan claims one.
  for (const id of ['free', 'pro', 'agency']) assert.deepEqual([...P.PLANS[id].features], [], id);
  const agency = cards.find(c => c.id === 'agency');
  assert.ok(agency.soon.some(s => /seats/i.test(s)) && agency.soon.some(s => /team activity/i.test(s)));
  assert.doesNotMatch(agency.blurb, /team|seat|role/i);
  assert.equal(P.PLANS.agency.seats, 1, 'one seat until team seats exist');
  assert.ok(P.ALL_PLANS_INCLUDE.some(f => /API/.test(f)) && P.ALL_PLANS_INCLUDE.some(f => /Invoices/.test(f)));
  const page = read('app/plans/page.tsx'), up = read('app/plans/upgrade.tsx');
  assert.match(page, /All plans include/);
  assert.match(up, /Coming soon · not included yet/);
});

test('R3-16: signed out during the beta, the Free card says the account starts on the beta', () => {
  assert.match(read('app/plans/upgrade.tsx'), /betaName \? 'Start free \(beta\)' : 'Start free'/);
});

test('R3-04: a recorded deposit shows the day it arrived, not when it was written', () => {
  const created = '2026-10-13T11:59:00.000Z';
  assert.deepEqual(depositPaidWhen({kind: 'payment_received', payload: {received: '2026-10-12', amount: 35400}, created}), {paid_at: null, paid_on: '2026-10-12'});
  assert.deepEqual(depositPaidWhen({kind: 'payment', payload: {payment_id: 'pay_1'}, created}), {paid_at: created, paid_on: null});
  assert.deepEqual(depositPaidWhen({kind: 'payment_received', payload: {}, created}), {paid_at: created, paid_on: null}, 'falls back to the record time');
  assert.deepEqual(depositPaidWhen(undefined), {paid_at: null, paid_on: null});
  assert.match(read('lib/deposit-server.ts'), /depositPaidWhen\(src\)/);
  assert.match(read('app/review/[token]/review.tsx'), /deposit\.paid\.paid_on \? t\('deposit\.receivedOn', \{date: formatDay\(deposit\.paid\.paid_on\)\}\)/);
});

test('R3-10: API and MCP item schemas define price as the line total and accept unit_price; totals follow lib/money', () => {
  const api = read('app/api/openapi/route.ts'), mcp = read('lib/mcp.ts'), co = read('lib/mcp-ledger.ts');
  for (const src of [api, mcp, co]) { assert.match(src, /Line total for all qty/); assert.match(src, /unit_price/); }
  fc.assert(fc.property(fc.integer({min: 1, max: 500}), fc.integer({min: 0, max: 100000}), (qty, paise) => {
    const unit = paise / 100, item = itemSchema.parse({id: 'a', title: 'Logo', qty, unit_price: unit});
    return lineTotal(item, 'INR') === Math.round(unit * 100) * qty / 100;
  }));
});

test('R3-11: an unmapped auth error keeps the typed password', () => {
  assert.equal(authProblem({status: 422, code: 'PASSWORD_TOO_SHORT', message: 'Password too short'}, 'sign-up').credentials, false);
  assert.equal(authProblem({status: 400, message: 'Something odd'}, 'sign-in').credentials, false);
  assert.equal(authProblem({status: 401, code: 'INVALID_EMAIL_OR_PASSWORD'}, 'sign-in').credentials, true);
});

test('R3-05/R3-09: new milestones get a title, short titles are flagged on their row, rows have distinct names', () => {
  const t = read('app/terms-editor.tsx');
  assert.match(t, /'On delivery'/); assert.match(t, /`Milestone \$\{n\}`/);
  assert.ok(!/title: '', pct/.test(t), 'no untitled new rows');
  assert.match(t, /aria-invalid=\{short \|\| undefined\}/);
  assert.match(t, /rowName\(titles, i, 'untitled milestone'\)/);
  assert.ok(!/Remove \$\{m\.title \|\| 'milestone'\}/.test(t));
});

test('R3-06/R3-07/R3-08/R3-13/R3-15/R3-17: notify rule, connect wording, idle saved note, one current marker', () => {
  const cn = read('app/workspace/client-notices.tsx');
  assert.match(cn, /checked=\{canEmail \? data\.notify_client : false\}/);
  assert.match(cn, /disabled=\{disabled \|\| busy \|\| !canEmail\}/);
  assert.match(cn, /flexWrap: 'wrap'/);
  const connect = read('app/connect/page.tsx');
  assert.ok(!connect.includes('Import Muse draft'));
  assert.match(connect, /Import a draft \(JSON\)…/);
  assert.match(read('app/saved-status.tsx'), /style=\{saved \? undefined : \{minHeight: 0, margin: 0\}\}/);
  const ui = read('app/ui.tsx');
  assert.match(ui, /a\.href!=='\/templates'/);
  assert.match(ui, /aria-current=\{path==='\/'&&session\?\.user\?'page':undefined\}/);
  assert.match(read('app/onboarding/page.tsx'), /<fieldset className="section-gap"><legend>Workspace mode/);
});

test('visual #15: an en-US browser on India time starts with Indian defaults', () => {
  assert.equal(countryFromLocale('en-US', 'Asia/Kolkata'), 'IN');
  assert.equal(countryFromLocale('en-US', 'Asia/Calcutta'), 'IN');
  assert.equal(countryFromLocale('en-US', 'America/New_York'), 'US');
});

test('visual #30: the dashboard stage and the Approval card use the same words', () => {
  assert.equal(label('pending'), 'Awaiting review');
  assert.equal(STAGE_LABEL.awaiting, label('pending'));
});

test('visual #11/#20/#29, C11/C13/C24: small layout and hierarchy fixes', () => {
  assert.match(read('app/components/slots/cosigner-editor.tsx'), /disabled=\{busy \|\| !dirty/);
  assert.ok(!read('app/components/slots/contact-change.tsx').includes("Current: {current || 'none'}"));
  assert.match(read('app/review/[token]/client.module.css'), /\.header \.picker\{order:2\}/);
  assert.match(read('app/workspace/shell.tsx'), /!active&&!coarse&&/);
  const ins = read('app/insights-panel.tsx');
  assert.ok(!/<h2/.test(ins), 'insights sit under the dashboard heading');
  assert.match(read('app/review/[token]/review.tsx'), /<Link className="help-link" href="\/">\{t\('actions\.create'\)\}<\/Link>/);
  assert.match(read('app/account/page.tsx'), /\{!checking&&<>\n  <h2 id="h-data">/);
});
