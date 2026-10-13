// L14: provider contract fixtures (tests/fixtures/providers, shapes from the Razorpay and Stripe
// docs). Each payload is signed the way the provider signs it and run through our parsers, so a
// parser change that stops understanding a real payload fails here. Pure, no network.
// @covers L14
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {readFileSync, readdirSync} from 'node:fs';
import './../support/property.mjs';

const rz = await import('../../lib/razorpay.ts');
const st = await import('../../lib/stripe.ts');
const dir = new URL('../fixtures/providers/', import.meta.url);
const load = name => readFileSync(new URL(name, dir), 'utf8');

test('every fixture is valid JSON with the documented envelope', () => {
  for (const provider of ['razorpay', 'stripe']) {
    const names = readdirSync(new URL(provider + '/', dir)).filter(n => n.endsWith('.json'));
    assert.ok(names.length >= 5, provider);
    for (const name of names) {
      const body = JSON.parse(load(`${provider}/${name}`));
      if (provider === 'razorpay') { assert.equal(body.entity, 'event'); assert.equal(body.event + '.json', name); assert.ok(body.contains.every(k => body.payload[k]?.entity)); }
      else { assert.equal(body.object, 'event'); assert.equal(body.type + '.json', name); assert.ok(body.data.object.id); }
    }
  }
});

test('Razorpay order.paid and payment.captured: signature verifies, paid payment parsed', () => {
  const secret = 'TEST-razorpay-webhook-secret';
  for (const name of ['order.paid', 'payment.captured']) {
    const raw = load(`razorpay/${name}.json`);
    const signature = createHmac('sha256', secret).update(raw).digest('hex');
    assert.equal(rz.verifyWebhookSignature(raw, signature, secret), true, name);
    assert.equal(rz.verifyWebhookSignature(raw + ' ', signature, secret), false, 'any byte change breaks the signature');
    assert.equal(rz.verifyWebhookSignature(raw, signature, 'other'), false);
    assert.deepEqual(rz.paidEvent(JSON.parse(raw), 'evt_1'), {event_id: 'evt_1', order_id: 'order_9A33XWu170gUtm', payment_id: 'pay_29QQoUBi66xm2f', amount_minor: 590000, currency: 'INR'});
  }
  for (const name of ['refund.processed', 'subscription.activated', 'subscription.charged', 'subscription.halted', 'subscription.cancelled']) assert.equal(rz.paidEvent(JSON.parse(load(`razorpay/${name}.json`)), null), null, `${name} is not a deposit payment`);
  const refund = JSON.parse(load('razorpay/refund.processed.json')).payload.refund.entity;
  assert.deepEqual([refund.status, refund.amount, refund.payment_id], ['processed', 300000, 'pay_29QQoUBi66xm2f']);
});

test('Stripe checkout events: signature verifies within tolerance, paid session parsed', () => {
  const secret = 'whsec_TEST';
  const now = 1760245900_000;
  for (const [name, currency, amount] of [['checkout.session.completed', 'EUR', 150000], ['checkout.session.async_payment_succeeded', 'GBP', 42000]]) {
    const raw = load(`stripe/${name}.json`);
    const t = Math.floor(now / 1000);
    const header = `t=${t},v1=${createHmac('sha256', secret).update(`${t}.${raw}`).digest('hex')}`;
    assert.equal(st.verifyStripeSignature(raw, header, secret, now), true, name);
    assert.equal(st.verifyStripeSignature(raw, header, secret, now + 3600_000), false, 'replayed outside the tolerance');
    const paid = st.stripePaidEvent(JSON.parse(raw));
    assert.equal(paid.currency, currency); assert.equal(paid.amount_minor, amount); assert.match(paid.payment_id, /^pi_/);
  }
  for (const name of ['charge.refunded', 'customer.subscription.updated', 'customer.subscription.deleted']) assert.equal(st.stripePaidEvent(JSON.parse(load(`stripe/${name}.json`))), null, name);
});
