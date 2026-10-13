// WS-04 pure tests (no server, no network): the project-wide money fold (C4, LT-21, M4), capture
// classification (H8, M20), payment routing without custody (C3, SF-20), UPI URIs (LT-02, SF-02),
// the Checkout signature (H7), sealed secrets and the escrow stub (SF-20). Seeded (FC_SEED).
import '../support/fc-setup.mjs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {fc, tick} from '../support/property.mjs';
import {approve, append} from '../support/chain.mjs';

const M = await import('../../lib/money-ledger.ts');
const R = await import('../../lib/payment-accounts.ts');
const U = await import('../../lib/upi.ts');
const rz = await import('../../lib/razorpay.ts');
const {StubEscrow, milestoneApproved, escrowProvider, CastlerEscrow} = await import('../../lib/escrow/index.ts');
const {agreementTotals} = await import('../../lib/agreement-totals.ts');

const content = (extra = {}) => ({title: 'Supersede fixture', client: 'Acme', deliverables: 'Logo design', exclusions: '', fee: 10000, currency: 'INR', revisions: 2, due: '', notes: '', deposit_pct: 30, ...extra});
const received = (amount, method = 'upi') => ({amount, method, received: '2026-10-01', reference: 'UTR1', note: ''});
const online = (amount, purpose = 'deposit', currency = 'INR') => ({provider: 'razorpay', purpose, order_id: 'order_' + amount, payment_id: 'pay_' + amount, amount, currency});

// ---- C4 / LT-21 / M4 --------------------------------------------------------------------------------
test('C4: superseding keeps the ₹3,000 received on v1: received 3,000, deposit covered, balance 7,000', async () => {
  // @covers C4 LT-21
  const v1 = await approve(content(), {version: 1});
  const v2 = await approve(content({notes: 'v2: same fee, new terms'}), {version: 2, decided: tick(10)});
  const entries = [];
  entries.push(await append(entries, v1, 'payment_received', received(3000), 'owner', tick(1)));
  const t = agreementTotals(v2.content, []);
  // After v2 is approved the current baseline is 2; the v1 payment still counts.
  const s = M.moneyState(entries, {baseline_version: 2, currency: 'INR', total: t.total, deposit: t.deposit});
  assert.equal(s.received, 300000);
  assert.equal(s.refunded, 0);
  assert.deepEqual(s.deposit, {due: 300000, paid: 300000, covered: true});
  assert.equal(M.balanceOpen(s, t.total), 700000);
  assert.equal(M.depositOpen(s), 0);
  // The refund lookup is project-wide: an online v1 payment is still found and refundable after v2.
  entries.push(await append(entries, v1, 'payment', online(1000), 'system', tick(2)));
  const line = M.projectPaymentLines(entries).find(l => l.seq === 2);
  assert.equal(line.baseline_version, 1); assert.equal(line.refundable, 1000);
  assert.equal(M.findPaymentEntry(entries, 2).payload.amount, 1000);
});

test('LT-21: v1 approved, payment_received ₹3,000 = deposit -> deposit paid', async () => {
  // @covers LT-21
  const v1 = await approve(content());
  const entries = [await append([], v1, 'payment_received', received(3000), 'owner', tick(1))];
  const t = agreementTotals(v1.content, entries);
  const s = M.moneyState(entries, {baseline_version: 1, currency: 'INR', total: t.total, deposit: t.deposit});
  assert.equal(s.deposit.covered, true);
  assert.equal(s.by_purpose.recorded, 300000);
});

test('M4: a ¥333 payment covers the ¥333 deposit of ¥1,000 @ 33.333% with no residue', async () => {
  // @covers M4
  const jp = content({currency: 'JPY', fee: 1000, deposit_pct: 33.333});
  const v1 = await approve(jp);
  const t = agreementTotals(v1.content, []);
  assert.equal(t.deposit, 333);
  const entries = [await append([], v1, 'payment', online(333, 'deposit', 'JPY'), 'system', tick(1))];
  const s = M.moneyState(entries, {baseline_version: 1, currency: 'JPY', total: t.total, deposit: t.deposit});
  assert.deepEqual(s.deposit, {due: 333, paid: 333, covered: true});
  assert.equal(M.depositOpen(s), 0);
});

test('C4 property: Σ received - Σ refunds is invariant under baseline changes (money conservation)', async () => {
  // @covers C4
  const base = await approve(content({deposit_pct: 0}), {version: 1});
  const op = fc.record({kind: fc.constantFrom('payment', 'payment_received', 'refund'), cents: fc.integer({min: 1, max: 5_000_000}), version: fc.integer({min: 1, max: 4})});
  await fc.assert(fc.asyncProperty(fc.array(op, {maxLength: 12}), fc.integer({min: 1, max: 4}), fc.integer({min: 0, max: 3}), async (ops, current, shift) => {
    const build = async remap => {
      const entries = [];
      for (const [i, o] of ops.entries()) {
        const b = {...base, version: remap(o.version)};
        const amount = o.cents / 100;
        const payload = o.kind === 'payment' ? online(amount) : o.kind === 'payment_received' ? received(amount) : {amount, method: 'upi', refunded: '2026-10-02', reference: '', note: ''};
        entries.push(await append(entries, b, o.kind, payload, o.kind === 'payment' ? 'system' : 'owner', tick(i + 1)));
      }
      return entries;
    };
    const a = await build(v => v), b = await build(v => ((v + shift - 1) % 4) + 1);
    const agreement = v => ({baseline_version: v, currency: 'INR', total: 1_000_000, deposit: 0});
    const net = s => s.received - s.refunded;
    const expected = ops.reduce((s, o) => s + (o.kind === 'refund' ? -o.cents : o.cents), 0);
    assert.equal(net(M.moneyState(a, agreement(current))), expected);
    assert.equal(net(M.moneyState(b, agreement(((current + shift - 1) % 4) + 1))), expected);
    assert.equal(net(M.moneyState(a, agreement(1))), net(M.moneyState(a, agreement(4))));
  }), {numRuns: 60});
});

test('carry-forward: a baseline_superseded entry must carry the net money before it', async () => {
  // @covers C4
  const v1 = await approve(content());
  const entries = [await append([], v1, 'payment_received', received(3000), 'owner', tick(1))];
  const good = [...entries, {seq: 2, kind: 'baseline_superseded', baseline_version: 1, payload: {from: 1, to: 2, paid_minor: 300000, invoiced_minor: 0}}];
  const bad = [...entries, {seq: 2, kind: 'baseline_superseded', baseline_version: 1, payload: {from: 1, to: 2, paid_minor: 0, invoiced_minor: 0}}];
  assert.equal(M.carryForwardOk(good, 'INR'), true);
  assert.equal(M.carryForwardOk(bad, 'INR'), false);
  // A baseline_superseded entry moves no money.
  assert.equal(M.moneyState(good, {baseline_version: 2, currency: 'INR', total: 1180000, deposit: 300000}).received, 300000);
});

// ---- H8 / M20 ---------------------------------------------------------------------------------------
test('M20: a 5,000 capture on a 5,900 order applies 5,000 and is short 900 (never dropped)', () => {
  // @covers M20
  assert.deepEqual(M.classifyCapture({open_minor: 590000, order_minor: 590000, captured_minor: 500000}), {apply_minor: 500000, excess_minor: 0, short_minor: 90000});
});

test('H8 property: random interleavings of checkout and capture never record coverage above the amount due without an excess entry', () => {
  // @covers H8
  const step = fc.oneof(
    fc.record({t: fc.constant('checkout')}),
    fc.record({t: fc.constant('offline'), cents: fc.integer({min: 1, max: 400_000})}),
    fc.record({t: fc.constant('capture'), pick: fc.nat(), delta: fc.integer({min: -50_000, max: 50_000})}),
  );
  fc.assert(fc.property(fc.integer({min: 1, max: 1_000_000}), fc.array(step, {maxLength: 25}), (due, steps) => {
    const orders = []; let applied = 0, excess = 0, offline = 0, captured = 0;
    const open = () => Math.max(0, due - applied - offline);
    for (const s of steps) {
      if (s.t === 'checkout') { if (open() > 0) { for (const o of orders) if (!o.paid) o.superseded = true; orders.push({amount: open(), paid: false, superseded: false}); } }
      else if (s.t === 'offline') { const take = Math.min(s.cents, open()); offline += take; }
      else if (orders.length) {
        const o = orders[s.pick % orders.length];
        if (o.paid) continue;
        o.paid = true;
        const amount = Math.max(1, o.amount + s.delta); captured += amount;
        const c = M.classifyCapture({open_minor: open(), order_minor: o.amount, captured_minor: amount});
        assert.equal(c.apply_minor + c.excess_minor, amount);
        applied += c.apply_minor; excess += c.excess_minor;
      }
      assert.ok(applied + offline <= due, 'coverage never exceeds the amount due');
    }
    assert.equal(applied + excess, captured, 'every captured unit is either applied or flagged as excess');
  }), {numRuns: 200});
});

// ---- C3 / SF-20 routing -----------------------------------------------------------------------------
const acct = (id, kind, pub = {}) => ({id, kind, status: 'active', public: pub});
const PROD = {NODE_ENV: 'production', RAZORPAY_KEY_ID: 'rzp_live_op', RAZORPAY_KEY_SECRET: 's', RAZORPAY_WEBHOOK_SECRET: 'w', STRIPE_SECRET_KEY: 'sk_live_op', STRIPE_WEBHOOK_SECRET: 'whsec_op'};

test('C3 routing matrix: UPI-only, BYO Razorpay, Razorpay OAuth, Stripe BYO, Route flag; operator keys refused in production', () => {
  // @covers C3 SF-20
  const upi = acct('pa_upi', 'upi', {vpa: 'asha@okhdfc', payee_name: 'Asha Design'});
  // Production with only operator keys: refused, and no UPI to fall back to.
  assert.deepEqual(R.chooseRoute([], 'INR', PROD).online, null);
  assert.equal(R.chooseRoute([], 'INR', PROD).status, 'operator_refused');
  assert.equal(R.chooseRoute([], 'EUR', PROD).status, 'operator_refused');
  // ... unless explicitly allowed (test/dev only), and outside production.
  assert.deepEqual(R.chooseRoute([], 'INR', {...PROD, SCOPEFLOW_ALLOW_OPERATOR_COLLECTION: '1'}).online, {provider: 'razorpay', via: 'operator', account_id: null});
  assert.deepEqual(R.chooseRoute([], 'EUR', {...PROD, NODE_ENV: 'development'}).online, {provider: 'stripe', via: 'operator', account_id: null});
  // UPI only: UPI for INR, nothing online, never UPI for other currencies.
  const u = R.chooseRoute([upi], 'INR', PROD);
  assert.deepEqual([u.status, u.online, u.upi], ['upi_only', null, {account_id: 'pa_upi', vpa: 'asha@okhdfc', payee_name: 'Asha Design'}]);
  assert.equal(R.chooseRoute([upi], 'USD', PROD).upi, null);
  // BYO Razorpay keys (with webhook secret) for INR.
  const keys = acct('pa_keys', 'razorpay_keys', {key_id: 'rzp_live_x', has_webhook_secret: true});
  assert.deepEqual(R.chooseRoute([upi, keys], 'INR', PROD).online, {provider: 'razorpay', via: 'keys', account_id: 'pa_keys'});
  // OAuth wins over keys, but needs the partner credentials.
  const oauth = acct('pa_oauth', 'razorpay_oauth', {razorpay_account_id: 'acc_1', public_token: 'rzp_test_oauth_1', has_webhook_secret: false});
  const partner = {...PROD, RAZORPAY_PARTNER_CLIENT_ID: 'cid', RAZORPAY_PARTNER_CLIENT_SECRET: 'cs', RAZORPAY_PARTNER_WEBHOOK_SECRET: 'pw'};
  assert.deepEqual(R.chooseRoute([keys, oauth], 'INR', partner).online, {provider: 'razorpay', via: 'oauth', account_id: 'pa_oauth'});
  assert.deepEqual(R.chooseRoute([keys, oauth], 'INR', PROD).online.via, 'keys');
  // Stripe BYO for other currencies; INR only when the owner opts in.
  const stripe = acct('pa_st', 'stripe_keys', {key_hint: 'rk_live_…1234', has_webhook_secret: true});
  assert.deepEqual(R.chooseRoute([stripe], 'USD', PROD).online, {provider: 'stripe', via: 'keys', account_id: 'pa_st'});
  assert.equal(R.chooseRoute([stripe], 'INR', PROD).online, null);
  assert.equal(R.chooseRoute([{...stripe, public: {...stripe.public, include_inr: true}}], 'INR', PROD).online.provider, 'stripe');
  assert.deepEqual(R.chooseRoute([keys, stripe], 'EUR', PROD).online.provider, 'stripe');
  // Route: only with the flag (Rs 40 lakh turnover rule), INR only, through the operator keys + transfer.
  const route = acct('pa_route', 'razorpay_route', {linked_account_id: 'acc_linked1'});
  assert.equal(R.chooseRoute([route], 'INR', PROD).online, null);
  assert.deepEqual(R.chooseRoute([route], 'INR', {...PROD, SCOPEFLOW_ROUTE_ENABLED: '1'}).online, {provider: 'razorpay', via: 'route', account_id: 'pa_route'});
  assert.equal(R.chooseRoute([route], 'USD', {...PROD, SCOPEFLOW_ROUTE_ENABLED: '1'}).online, null);
  // Disconnected accounts are never used.
  assert.equal(R.chooseRoute([{...keys, status: 'disconnected'}], 'INR', PROD).online, null);
});

test('H7: keys without a webhook secret are misconfigured: payments not enabled, warning for readiness', () => {
  // @covers H7
  const keys = acct('pa_keys', 'razorpay_keys', {key_id: 'rzp_live_x', has_webhook_secret: false});
  const r = R.chooseRoute([keys], 'INR', PROD);
  assert.equal(r.online, null); assert.equal(r.status, 'misconfigured');
  assert.match(r.warnings.join(' '), /webhook secret/);
  const st = rz.routeStatus(r);
  assert.equal(st.enabled, false); assert.doesNotMatch(st.reason, /RAZORPAY|SECRET/, 'the client-facing reason names no settings');
  // Operator keys (dev) without RAZORPAY_WEBHOOK_SECRET: misconfigured too.
  const dev = {NODE_ENV: 'development', RAZORPAY_KEY_ID: 'rzp_test_x', RAZORPAY_KEY_SECRET: 's'};
  assert.equal(rz.paymentsStatus(dev, 'INR').enabled, false);
  assert.equal(rz.paymentsStatus(dev, 'INR').status, 'misconfigured');
  assert.equal(rz.paymentsStatus({...dev, RAZORPAY_WEBHOOK_SECRET: 'w'}, 'INR').enabled, true);
});

test('H7: verifyPaymentSignature known vector (Razorpay: HMAC-SHA256 of "order_id|payment_id")', () => {
  // @covers H7
  const secret = 'EnLs21M47BllR3X8PSFtjtbd', order = 'order_9A33XWu170gUtm', payment = 'pay_29QQoUBi66xm2f';
  const sig = '972592aed892074d7fb0c0bb8ee7dd8736eb02d3c281fc503cf6fd8d3af443df';
  assert.equal(createHmac('sha256', secret).update(`${order}|${payment}`).digest('hex'), sig);
  assert.equal(rz.verifyPaymentSignature(order, payment, sig, secret), true);
  assert.equal(rz.verifyPaymentSignature(order, payment, sig.toUpperCase(), secret), true);
  assert.equal(rz.verifyPaymentSignature(order, 'pay_other', sig, secret), false);
  assert.equal(rz.verifyPaymentSignature(order, payment, sig.slice(0, 63) + (sig[63] === '0' ? '1' : '0'), secret), false);
  assert.equal(rz.verifyPaymentSignature(order, payment, 'not-hex', secret), false);
});

test('sealed secrets: AES-GCM round trip; tampering and a wrong key fail; no key off localhost refuses', () => {
  // @covers SF-20 C3
  const env = {SCOPEFLOW_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64')};
  const sealed = R.sealSecret({key_secret: 'shh', webhook_secret: 'w'}, env);
  assert.doesNotMatch(sealed, /shh/);
  assert.deepEqual(R.openSecret(sealed, env), {key_secret: 'shh', webhook_secret: 'w'});
  // Flip the second-to-last character (it was compared against the last one, so 1 in 64 random IVs changed nothing).
  assert.throws(() => R.openSecret(sealed.slice(0, -2) + (sealed.at(-2) === 'A' ? 'B' : 'A') + sealed.slice(-1), env));
  assert.throws(() => R.openSecret(sealed, {SCOPEFLOW_ENCRYPTION_KEY: Buffer.alloc(32, 8).toString('base64')}));
  assert.throws(() => R.sealSecret({key_secret: 'x'}, {APP_URL: 'https://scope-flow.tech'}), R.EncryptionUnavailable);
  assert.deepEqual(R.openSecret(R.sealSecret({a: 1}, {APP_URL: 'http://localhost:5173', SCOPEFLOW_SIGNING_SECRET: 's'}), {APP_URL: 'http://localhost:5173', SCOPEFLOW_SIGNING_SECRET: 's'}), {a: 1});
});

// ---- LT-02 / SF-02 UPI ------------------------------------------------------------------------------
test('upiUri(): escaping, amount with exactly 2 decimals, tn at most 80 characters, INR only', () => {
  // @covers LT-02 SF-02
  const uri = U.upiUri({vpa: 'asha.design@okhdfcbank', payee: 'Asha & Co. Design', amount_minor: 2950000, currency: 'INR', note: U.upiNote('Brand refresh / logo & guide', 'Deposit'), ref: U.upiRef('p_abc-123', 'deposit')});
  assert.equal(uri, 'upi://pay?pa=asha.design@okhdfcbank&pn=Asha%20%26%20Co.%20Design&am=29500.00&cu=INR&tn=Brand%20refresh%20%2F%20logo%20%26%20guide%20Deposit&tr=SFpabc123D');
  const p = U.parseUpiUri(uri);
  assert.deepEqual([p.pa, p.pn, p.am, p.cu, p.tn], ['asha.design@okhdfcbank', 'Asha & Co. Design', '29500.00', 'INR', 'Brand refresh / logo & guide Deposit']);
  for (const [minor, am] of [[1, '0.01'], [10, '0.10'], [100, '1.00'], [2950050, '29500.50'], [12345678901, '123456789.01']]) assert.equal(U.parseUpiUri(U.upiUri({vpa: 'ab@okaxis', payee: 'x', amount_minor: minor, currency: 'INR', note: 'n', ref: 'r'})).am, am);
  fc.assert(fc.property(fc.string({maxLength: 300}), fc.string({maxLength: 40}), fc.integer({min: 1, max: 1e12}), (title, purpose, minor) => {
    const tn = U.upiNote(title, purpose);
    assert.ok([...tn].length <= U.UPI_NOTE_MAX, tn);
    const parsed = U.parseUpiUri(U.upiUri({vpa: 'ab@okaxis', payee: title || 'x', amount_minor: minor, currency: 'INR', note: tn, ref: 'SFref'}));
    assert.ok([...parsed.tn].length <= 80);
    assert.match(parsed.am, /^\d+\.\d{2}$/);
    assert.equal(Math.round(Number(parsed.am) * 100), minor);
    assert.equal(parsed.cu, 'INR');
  }), {numRuns: 300});
  assert.equal(U.upiUri({vpa: 'ab@okaxis', payee: 'x', amount_minor: 100, currency: 'USD', note: 'n', ref: 'r'}), null, 'never UPI for non-INR');
  assert.equal(U.upiUri({vpa: 'not a vpa', payee: 'x', amount_minor: 100, currency: 'INR', note: 'n', ref: 'r'}), null);
  assert.equal(U.parseUtr('4123 5678 9012', 'upi'), '412356789012');
  assert.equal(U.parseUtr('12345', 'upi'), null);
  assert.equal(U.parseUtr('hdfcr52026101200001', 'bank_transfer'), 'HDFCR52026101200001');
  assert.equal(U.maskRef('412356789012'), '••••••••9012');
  assert.deepEqual(U.upiAppLinks('upi://pay?pa=a@b&am=1.00').map(l => l.href.split('?')[0]), ['tez://upi/pay', 'phonepe://pay', 'paytmmp://pay', 'upi://pay']);
});

// ---- SF-20 escrow -----------------------------------------------------------------------------------
test('escrow stub: release only after the milestone approval entry; refunds only unreleased money', async () => {
  // @covers SF-20
  const e = new StubEscrow();
  const s = await e.createEscrow({project_id: 'p1', currency: 'INR', milestones: [{id: 'm1', title: 'Design', amount_minor: 500000}, {id: 'm2', title: 'Build', amount_minor: 700000}], buyer: {name: 'Client'}, seller: {name: 'Asha'}});
  await assert.rejects(e.release(s.escrow_id, 'm1', {entries: []}), /funded/);
  e.fund(s.escrow_id, 'm1');
  await assert.rejects(e.release(s.escrow_id, 'm1', {entries: []}), {code: 'not_approved'});
  await assert.rejects(e.release(s.escrow_id, 'm1', {entries: [{seq: 1, kind: 'delivery_accepted', payload: {milestone_id: 'm2'}}]}), {code: 'not_approved'}, 'another milestone’s approval does not release this one');
  const evidence = {entries: [{seq: 3, kind: 'delivery_accepted', payload: {milestone_id: 'm1', outcome: 'accepted'}}]};
  assert.equal(milestoneApproved(evidence, 'm1'), true);
  const after = await e.release(s.escrow_id, 'm1', evidence);
  assert.deepEqual(after.milestones.map(m => [m.id, m.state, m.released_minor]), [['m1', 'released', 500000], ['m2', 'awaiting_funds', 0]]);
  await assert.rejects(e.refund(s.escrow_id, 'm1', 1), {code: 'bad_state'});
  e.fund(s.escrow_id, 'm2');
  await assert.rejects(e.refund(s.escrow_id, 'm2', 700001), {code: 'refund_exceeds'});
  assert.equal((await e.refund(s.escrow_id, 'm2', 700000)).milestones[1].state, 'refunded');
  // Real providers stay off until an agreement exists; the stub is never used in production.
  assert.equal(escrowProvider({}), null);
  assert.equal(escrowProvider({SCOPEFLOW_ESCROW_PROVIDER: 'stub', NODE_ENV: 'production'}), null);
  await assert.rejects(new CastlerEscrow({CASTLER_CLIENT_ID: 'x', CASTLER_CLIENT_SECRET: 'y'}).createEscrow({}), {code: 'escrow_unavailable'});
});
