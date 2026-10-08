// PR F: Razorpay deposit scaffold. Pure (no server, no network): configuration, minor units,
// deposit amount, order creation through a stubbed fetch, webhook and checkout signature
// verification, and parsing of paid events. Also checks the new ledger kind.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {fc} from '../support/property.mjs';

const rz = await import('../../lib/razorpay.ts');
const {payloadSchemas, describeEntry} = await import('../../lib/ledger.ts');
const {scopeSchema} = await import('../../lib/scope.ts');

test('payments are off without keys, with a reason; webhook secret is separate', () => {
  assert.equal(rz.razorpayConfig({}), null);
  assert.equal(rz.razorpayConfig({RAZORPAY_KEY_ID: 'rzp_test_x'}), null);
  assert.deepEqual(rz.razorpayConfig({RAZORPAY_KEY_ID: 'rzp_test_x', RAZORPAY_KEY_SECRET: 's'}), {keyId: 'rzp_test_x', keySecret: 's'});
  assert.match(rz.paymentsStatus({}).reason, /RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET/);
  assert.equal(rz.paymentsStatus({RAZORPAY_WEBHOOK_SECRET: 'w'}).webhook, true);
  assert.equal(rz.webhookSecret({RAZORPAY_WEBHOOK_SECRET: '  '}), null);
});

test('amounts: minor units per currency; deposit from the fee (and tax when present)', () => {
  assert.equal(rz.toMinorUnits(1234.56, 'INR'), 123456);
  assert.equal(rz.toMinorUnits(1800, 'JPY'), 1800);
  assert.equal(rz.fromMinorUnits(123456, 'INR'), 1234.56);
  assert.equal(rz.depositAmount({fee: 100000, deposit_pct: 30}), 30000);
  assert.equal(rz.depositAmount({fee: 1000, deposit_pct: 50, tax_pct: 18}), 590);
  assert.equal(rz.depositAmount({fee: 1000}), 0);
  fc.assert(fc.property(fc.integer({min: 0, max: 10_000_000_00}), minor => assert.equal(rz.toMinorUnits(rz.fromMinorUnits(minor, 'INR'), 'INR'), minor)));
});

test('deposit charged equals the deposit on the signed scope paper (one source: money.totals)', async () => {
  const {totals} = await import('../../lib/money.ts');
  // A fee where the old formula (rounding only once, on the unrounded tax-inclusive total) charged a cent more.
  assert.equal(totals({fee: 97246.8, tax_pct: 18, deposit_pct: 79}).deposit, 90653.46);
  assert.equal(rz.depositAmount({fee: 97246.8, tax_pct: 18, deposit_pct: 79}), 90653.46);
  fc.assert(fc.property(fc.integer({min: 0, max: 1_000_000_00}).map(c => c / 100), fc.constantFrom(0, 5, 7.5, 8.25, 12, 18, 28), fc.integer({min: 0, max: 100}), (fee, tax_pct, deposit_pct) => {
    const paper = totals({fee, tax_pct, deposit_pct}).deposit;
    assert.equal(rz.depositAmount({fee, tax_pct, deposit_pct}), deposit_pct > 0 ? paper : 0);
  }), {numRuns: 2000});
});

test('order creation: POST /v1/orders with basic auth, paise and notes', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => { calls.push({url, init, body: JSON.parse(init.body)}); return new Response(JSON.stringify({id: 'order_123', amount: 30000, currency: 'INR', status: 'created'}), {status: 200}); };
  const order = await rz.createOrder({keyId: 'rzp_test_k', keySecret: 'sec'}, {amount_minor: 30000, currency: 'INR', receipt: 'sf-' + 'x'.repeat(60), notes: {project_id: 'p1'}}, fetchImpl);
  assert.deepEqual(order, {id: 'order_123', amount: 30000, currency: 'INR', status: 'created'});
  assert.equal(calls[0].url, 'https://api.razorpay.com/v1/orders');
  assert.equal(calls[0].init.headers.Authorization, 'Basic ' + Buffer.from('rzp_test_k:sec').toString('base64'));
  assert.deepEqual(calls[0].body, {amount: 30000, currency: 'INR', receipt: ('sf-' + 'x'.repeat(60)).slice(0, 40), notes: {project_id: 'p1'}});
  await assert.rejects(rz.createOrder({keyId: 'k', keySecret: 's'}, {amount_minor: 1, currency: 'INR', receipt: 'r', notes: {}}, async () => new Response(JSON.stringify({error: {description: 'Authentication failed'}}), {status: 401})), /Authentication failed/);
  await assert.rejects(rz.createOrder({keyId: 'k', keySecret: 's'}, {amount_minor: 1, currency: 'INR', receipt: 'r', notes: {}}, async () => { throw new Error('down'); }), rz.RazorpayError);
});

test('webhook signature: HMAC-SHA256 of the raw body, constant-time, rejects any change', () => {
  const body = JSON.stringify({event: 'payment.captured', payload: {}});
  const sig = createHmac('sha256', 'whsec').update(body).digest('hex');
  assert.equal(rz.verifyWebhookSignature(body, sig, 'whsec'), true);
  assert.equal(rz.verifyWebhookSignature(body, sig.toUpperCase(), 'whsec'), true);
  assert.equal(rz.verifyWebhookSignature(body + ' ', sig, 'whsec'), false);
  assert.equal(rz.verifyWebhookSignature(body, sig, 'other'), false);
  for (const bad of [null, '', 'zz', sig.slice(0, 10), sig + '00']) assert.equal(rz.verifyWebhookSignature(body, bad, 'whsec'), false);
  fc.assert(fc.property(fc.string(), fc.string({minLength: 1}), (b, s) => assert.equal(rz.verifyWebhookSignature(b, createHmac('sha256', s).update(b).digest('hex'), s), true)));
});

test('checkout handler signature: HMAC of "order_id|payment_id" with the key secret', () => {
  const sig = createHmac('sha256', 'ks').update('order_1|pay_1').digest('hex');
  assert.equal(rz.verifyPaymentSignature('order_1', 'pay_1', sig, 'ks'), true);
  assert.equal(rz.verifyPaymentSignature('order_1', 'pay_2', sig, 'ks'), false);
});

test('paid events: payment.captured and order.paid only, with a captured payment entity', () => {
  const entity = {id: 'pay_9', order_id: 'order_9', amount: 30000, currency: 'INR', status: 'captured'};
  assert.deepEqual(rz.paidEvent({event: 'payment.captured', payload: {payment: {entity}}}, 'evt_1'), {event_id: 'evt_1', order_id: 'order_9', payment_id: 'pay_9', amount_minor: 30000, currency: 'INR'});
  assert.ok(rz.paidEvent({event: 'order.paid', payload: {payment: {entity}}}, null));
  assert.equal(rz.paidEvent({event: 'payment.failed', payload: {payment: {entity}}}, null), null);
  assert.equal(rz.paidEvent({event: 'payment.captured', payload: {payment: {entity: {...entity, status: 'failed'}}}}, null), null);
  assert.equal(rz.paidEvent({event: 'payment.captured', payload: {payment: {entity: {...entity, amount: '30000'}}}}, null), null);
  assert.equal(rz.paidEvent(null, null), null);
});

test('ledger: the payment kind validates strictly and reads as a deposit; scopes accept deposit_pct', () => {
  const p = {provider: 'razorpay', purpose: 'deposit', order_id: 'order_9', payment_id: 'pay_9', amount: 300, currency: 'INR'};
  assert.equal(payloadSchemas.payment.safeParse(p).success, true);
  assert.equal(payloadSchemas.payment.safeParse({...p, provider: 'stripe'}).success, false);
  assert.equal(payloadSchemas.payment.safeParse({...p, extra: 1}).success, false);
  assert.equal(describeEntry({seq: 3, kind: 'payment', payload: p}, 'INR'), 'Deposit received: ₹300.00 via Razorpay (payment pay_9)');
  const base = {title: 'T scope', client: 'Client', deliverables: 'Logo design', exclusions: '', fee: 100, currency: 'INR', revisions: 1, due: '', notes: ''};
  assert.equal(scopeSchema.parse({...base, deposit_pct: 30}).deposit_pct, 30);
  assert.equal(scopeSchema.safeParse({...base, deposit_pct: 130}).success, false);
  assert.ok(!('deposit_pct' in scopeSchema.parse(base)));
});
