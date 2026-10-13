// UX round 4a (reaudit4.md): per-plan version and record-entry caps (R4-01), the deposit's received day once
// later payments arrive (R4-07), unticked checkbox edges (R4-08, ratios in ws-09-theme.test.mjs), the milestone
// title error after blur (R4-10) and the payment-terms placeholder (R4-12). Seeded, no network.
import '../support/fc-setup.mjs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fc} from '../support/property.mjs';

const P = await import('../../lib/plans.ts');
const {depositCoveredBy, depositPaidWhen} = await import('../../lib/deposit-paid.ts');
const read = rel => readFileSync(new URL('../../' + rel, import.meta.url), 'utf8');

const NOW = Date.parse('2026-10-13T12:00:00Z');
const active = plan => ({plan, status: 'active', period_end: '2026-11-13T00:00:00Z', grace_until: null});
// The limits the server enforces for an owner: what limitsFor(owner) returns (lib/billing.ts), minus the DB read.
const enforced = (row, env = {}) => P.resolvePlan(row, NOW, env).plan.limits;

test('R4-01: Pro and Agency owners get their own version and record-entry caps, above the beta default', () => {
  const beta = enforced(null), pro = enforced(active('pro')), agency = enforced(active('agency'));
  assert.deepEqual([beta.versions, beta.ledger_entries], [100, 200], 'beta default unchanged');
  assert.deepEqual([pro.versions, pro.ledger_entries], [200, 1000]);
  assert.deepEqual([agency.versions, agency.ledger_entries], [200, 2000]);
  // A Pro project at 150 versions / 500 entries may grow; the beta default refuses it.
  assert.equal(P.versionCapError(150, pro), null);
  assert.equal(P.ledgerCapError(500, pro), null);
  assert.equal(P.ledgerCapError(1500, agency), null);
  assert.match(P.versionCapError(150, beta), /up to 100 versions per project/);
  assert.match(P.ledgerCapError(500, beta), /200 ledger entries per project/);
  assert.match(P.ledgerCapError(1000, pro), /1000 ledger entries per project/);
  // Lapsed subscriptions drop to Free; a pending checkout keeps the default.
  assert.equal(enforced({...active('pro'), status: 'expired'}).ledger_entries, P.PLANS.free.limits.ledger_entries);
  assert.equal(enforced({...active('pro'), status: 'pending'}).versions, 100);
  // The env overrides still shape only the default plan.
  assert.equal(enforced(null, {SCOPEFLOW_LIMIT_LEDGER_ENTRIES: '50'}).ledger_entries, 50);
  assert.equal(enforced(active('pro'), {SCOPEFLOW_LIMIT_LEDGER_ENTRIES: '50'}).ledger_entries, 1000);
});

test('R4-01: every number on a plan card is the cap the server enforces for that plan', () => {
  for (const c of P.planCards('INR', n => '₹' + n)) {
    const l = enforced(active(c.id));
    assert.ok(c.lines.includes(`${l.versions} versions per project`), c.id);
    assert.ok(c.lines.includes(`${l.ledger_entries.toLocaleString('en-IN')} record entries per project`), c.id);
  }
});

test('R4-01: the cap helpers refuse exactly at the cap', () => {
  fc.assert(fc.property(fc.integer({min: 1, max: 5000}), fc.integer({min: 0, max: 6000}), (cap, n) =>
    (P.versionCapError(n, {versions: cap}) === null) === (n < cap) && (P.ledgerCapError(n, {ledger_entries: cap}) === null) === (n < cap)));
});

test('R4-01: the version and record-entry checks read the owner\'s plan (limitsFor), not the server default', () => {
  const route = read('app/api/scopes/[id]/route.ts'), ledger = read('lib/ledger-server.ts');
  assert.match(route, /const lim=await limitsFor\(user\),capped=versionCapError\(p\.latest,lim\)/);
  assert.doesNotMatch(route, /limits\(\)\.versions/);
  assert.match(ledger, /ledgerCapError\(count, owner \? await limitsFor\(owner\.owner\) : limits\(\)\)/);
  assert.doesNotMatch(ledger, /limits\(\)\.ledger_entries/);
});

const e = (seq, kind, payload, created = `2026-10-${String(10 + seq).padStart(2, '0')}T10:00:00Z`) => ({seq, kind, payload, created});

test('R4-07: a later balance payment never moves the deposit\'s received day', () => {
  // ₹35,400 deposit received 12 Oct, then ₹10,000 of the balance on 13 Oct (the reaudit probe P5).
  const entries = [e(1, 'payment_received', {amount: 35400, received: '2026-10-12'}), e(2, 'payment_received', {amount: 10000, received: '2026-10-13'})];
  const {src} = depositCoveredBy(entries, 'INR', 3540000);
  assert.deepEqual(depositPaidWhen(src), {paid_at: null, paid_on: '2026-10-12'});
  // A later online invoice payment doesn't take over either.
  const withOnline = [...entries, e(3, 'payment', {payment_id: 'pay_late', amount: 5000, purpose: 'invoice'})];
  const c = depositCoveredBy(withOnline, 'INR', 3540000);
  assert.equal(c.src.seq, 1);
  assert.equal(c.online, undefined);
});

test('R4-07: two part-payments covering the deposit show the day of the one that completed it', () => {
  const entries = [e(1, 'payment_received', {amount: 20000, received: '2026-10-10'}), e(2, 'payment', {payment_id: 'pay_2', amount: 15400, purpose: 'deposit'}), e(3, 'payment_received', {amount: 50000, received: '2026-10-20'})];
  const c = depositCoveredBy(entries, 'INR', 3540000);
  assert.equal(c.src.seq, 2);
  assert.equal(c.online.payload.payment_id, 'pay_2');
  assert.deepEqual(depositPaidWhen(c.src), {paid_at: entries[1].created, paid_on: null});
  // A confirmed client claim carries its received day.
  const claim = [e(1, 'payment_claim_confirmed', {amount_minor: 3540000, currency: 'INR', method: 'upi', received: '2026-10-11'})];
  assert.deepEqual(depositPaidWhen(depositCoveredBy(claim, 'INR', 3540000).src), {paid_at: null, paid_on: '2026-10-11'});
});

test('R4-07: a refund that reopens the deposit moves the day to the payment that covered it again', () => {
  const entries = [e(1, 'payment_received', {amount: 35400, received: '2026-10-12'}), e(2, 'refund', {amount: 35400}), e(3, 'payment_received', {amount: 40000, received: '2026-10-18'}), e(4, 'payment_received', {amount: 1000, received: '2026-10-19'})];
  assert.equal(depositCoveredBy(entries, 'INR', 3540000).src.seq, 3);
  assert.equal(depositCoveredBy(entries.slice(0, 2), 'INR', 3540000).src, undefined, 'not covered after the refund');
  assert.equal(depositCoveredBy(entries, 'INR', 0).src, undefined, 'no deposit, no day');
});

test('R4-07: the covering entry is the first prefix that reaches the deposit (property)', () => {
  fc.assert(fc.property(fc.array(fc.integer({min: 1, max: 50000}), {minLength: 1, maxLength: 8}), fc.integer({min: 1, max: 100000}), (amounts, deposit) => {
    const entries = amounts.map((a, i) => e(i + 1, 'payment_received', {amount: a, received: `2026-11-${String(i + 1).padStart(2, '0')}`}));
    let sum = 0, want;
    for (const x of entries) { sum += x.payload.amount * 100; if (sum >= deposit * 100) { want = x.seq; break; } }
    return depositCoveredBy(entries, 'INR', deposit * 100).src?.seq === want;
  }));
  assert.match(read('lib/deposit-server.ts'), /depositCoveredBy\(ledger\.entries, content\.currency, totals\.deposit\)/);
  assert.doesNotMatch(read('lib/deposit-server.ts'), /money\.at\(-1\)/);
});

test('R4-08: native checkboxes and radios draw their own box with a --rule-strong edge and no fill when unticked', () => {
  const css = read('app/globals.css');
  const rule = css.match(/input\[type=checkbox\],input\[type=radio\]\{([^}]*)\}/)[1];
  assert.match(rule, /appearance:none/);
  assert.match(rule, /border:1\.5px solid var\(--rule-strong\)/);
  assert.match(rule, /background:transparent/);
  assert.match(css, /input\[type=checkbox\]:checked\{background:var\(--accent\)\}/);
  assert.match(css, /input\[type=checkbox\]::before\{[^}]*background:var\(--on-accent\)/);
  assert.match(css, /@media \(forced-colors:active\)\{input\[type=checkbox\],input\[type=radio\]\{appearance:auto/);
});

test('R4-10: a short milestone title is flagged after the field is left, not while retyping', () => {
  const src = read('app/terms-editor.tsx');
  assert.match(src, /const short = m\.title\.trim\(\)\.length < 2 && editing !== m\.id/);
  assert.match(src, /onFocus=\{\(\) => setEditing\(m\.id\)\} onBlur=\{\(\) => setEditing\(null\)\}/);
});

test('R4-12: the payment terms placeholder fits a 390px field', () => {
  const src = read('app/workspace/editor.tsx');
  assert.match(src, /placeholder="e\.g\. Balance in 15 days"/);
  assert.doesNotMatch(src, /Balance due within 15 days of delivery/);
});

test('visual #11, #22, #32: identity panels are spaced, the consent box shows invalid, hover tints need hover', () => {
  assert.match(read('app/components/evidence/identity-slots.module.css'), /\.panel \+ \.panel \{ margin-top:/);
  const css = read('app/globals.css');
  assert.match(css, /\[data-slot=checkbox\]\{[^}]*background:transparent!important/);
  assert.match(css, /\[data-slot=checkbox\]\[aria-invalid=true\]:not\(\[data-state=checked\]\)\{border-color:var\(--bad\)!important/);
  assert.match(css, /@media \(hover:hover\)\{\.secondary:hover:not\(:disabled\)/);
  assert.match(read('app/review/[token]/review.tsx'), /aria-invalid=\{\(!!decideError && !checked\) \|\| undefined\}/);
});
