// Payment copy regression (pure, no server). Razorpay and Stripe payments are built, so no page
// may still claim that Scopeflow takes no payments, and the pages that describe money must say what
// the code does: Scopeflow charges creators nothing; a client can pay a creator-set deposit on the
// review link (and open invoices), after approving, through Razorpay or Stripe Checkout, into the
// account configured by the server operator (lib/razorpay.ts, lib/stripe.ts), with no payouts to creators.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, readdirSync, statSync} from 'node:fs';
import {join, relative} from 'node:path';

const root = new URL('../../', import.meta.url).pathname;
const read = p => readFileSync(join(root, p), 'utf8');
function walk(dir, out = []) {
  for (const name of readdirSync(join(root, dir))) {
    const p = join(dir, name);
    if (statSync(join(root, p)).isDirectory()) walk(p, out);
    else if (/\.(tsx|ts)$/.test(name)) out.push(p);
  }
  return out;
}

// Phrases that say Scopeflow does not take payments at all ("does not collect payment",
// "process payments" in a list of things it does not do, "no ... payment collection").
export const FORBIDDEN = [
  /\b(?:does not|doesn['’]t|do not|never|no|not)\b[^.'"`]{0,80}?\b(?:collects?|collecting|process(?:es)?|processing|takes?|accepts?)\s+payments?\b/i,
  /\bno\b[^.'"`]{0,60}?\bpayment collection\b/i,
];
const offending = text => FORBIDDEN.map(re => re.exec(text)?.[0]).filter(Boolean);

test('no page, component or API description says Scopeflow takes no payments', () => {
  const files = [...walk('app'), ...walk('components')];
  assert.ok(files.some(f => f.endsWith('terms/page.tsx')) && files.some(f => f.endsWith('review.tsx')), 'scans the pages');
  const hits = files.flatMap(f => offending(read(f)).map(m => `${relative(root, join(root, f))}: “${m}”`));
  assert.deepEqual(hits, []);
});

test('the patterns catch the old wording', () => {
  for (const old of [
    'The current beta is free and does not collect payments or renew subscriptions.',
    'This beta does not send messages, verify signatures, process payments, offer team workspaces',
    'This link does not verify your identity and does not collect payment.',
    'There is no automatic renewal or payment collection.',
  ]) assert.notDeepEqual(offending(old), [], old);
  for (const fine of ['Saving or approving a scope never charges anyone by itself.', 'Do not include passwords, payment card details', 'Scopeflow does not see or store card, UPI or bank details.'])
    assert.deepEqual(offending(fine), [], fine);
});

// changed by the gap-audit fixes (H6): the terms follow the code. Paid plans exist (lib/plans.ts PURCHASABLE,
// lib/billing.ts) and client money goes to the creator's own account (C3, lib/payment-accounts.ts).
test('terms: paid plans exist; client payments go to an account the creator owns', () => {
  const terms = read('app/terms/page.tsx');
  assert.doesNotMatch(terms, /does not charge you, sell subscriptions, or renew anything/);
  assert.doesNotMatch(terms, /merchant account the server operator configured/);
  assert.match(terms, /paid subscription plans \(Pro and Agency/);
  assert.match(terms, /renews automatically each period until it is cancelled/);
  assert.match(terms, /href="\/refund"/);
  assert.match(terms, /<h2>Client payments<\/h2>/);
  assert.match(terms, /the creator’s own Razorpay account/);
  assert.match(terms, /the creator’s own Stripe account/);
  assert.match(terms, /The money settles to the creator, never to Scopeflow/);
  assert.match(terms, /refund an online payment, in full or in part, through the same provider/);
  assert.match(terms, /only after the provider confirms it/);
  // Prices are not repeated in the terms (they had drifted from the Plans page: $9/$19 vs $4).
  assert.doesNotMatch(terms, /[$₹]\s?\d/);
});

test('reviewer guide and review page describe the deposit accurately', () => {
  const guide = read('app/reviewer-guide/page.tsx');
  assert.match(guide, /pay it on the review link after approving, through Razorpay Checkout or Stripe Checkout, into the creator’s own account/);
  assert.match(guide, /Saving or approving a scope never charges anyone by itself/);
  // changed by WS-07: the client page's copy moved into the message catalog (SF-09); review.tsx renders it.
  const review = read('app/review/[token]/review.tsx') + read('messages/en.json');
  assert.match(review, /Approving or requesting changes does not charge you\. If the scope asks for a deposit, it is paid separately on this page after you approve, through Razorpay or Stripe/);
});

// changed by WS-04: client money no longer goes through the operator's keys (C3, plan §11). The
// code now routes every client charge to an account the freelancer owns; the operator's keys are
// refused for client charges in production. The terms, reviewer guide and privacy copy that still
// describe the operator's merchant account are owned elsewhere (change request in the WS-04 PR).
test('the code matches the routing: client charges go to the freelancer, operator keys refused in production', async () => {
  // @covers C3
  const route = read('lib/checkout-server.ts');
  assert.match(route, /routeForOwner\(/, 'checkout picks the owner’s destination');
  assert.doesNotMatch(route, /razorpayConfig\(\)!|stripeConfig\(\)!/, 'no unconditional operator keys');
  const accounts = read('lib/payment-accounts.ts');
  assert.match(accounts, /SCOPEFLOW_ALLOW_OPERATOR_COLLECTION/);
  assert.match(accounts, /NODE_ENV !== 'production'/);
  const R = await import('../../lib/payment-accounts.ts');
  assert.equal(R.chooseRoute([], 'INR', {NODE_ENV: 'production', RAZORPAY_KEY_ID: 'rzp_live_x', RAZORPAY_KEY_SECRET: 's', RAZORPAY_WEBHOOK_SECRET: 'w'}).online, null);
  // Stripe Connect transfers are not used; Route transfers only behind SCOPEFLOW_ROUTE_ENABLED.
  assert.doesNotMatch(route + read('lib/stripe.ts'), /transfer_data|application_fee|stripe_account/i);
  assert.match(read('lib/payment-accounts.ts'), /SCOPEFLOW_ROUTE_ENABLED/);
});
