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

test('terms: Scopeflow is free; client payments go through Razorpay or Stripe to the operator-configured account', () => {
  const terms = read('app/terms/page.tsx');
  assert.match(terms, /Scopeflow itself is free during this beta/);
  assert.match(terms, /<h2>Client payments<\/h2>/);
  assert.match(terms, /through Razorpay Checkout or Stripe Checkout/);
  assert.match(terms, /Razorpay or Stripe merchant account the server operator configured, not to an account of the creator/);
  assert.match(terms, /does not connect creators’ own payment accounts or pay money out to creators/);
  assert.match(terms, /refund an online payment, in full or in part, through the same provider/);
  assert.match(terms, /only after Razorpay or Stripe confirms it/);
  // Prices are not repeated in the terms (they had drifted from the Plans page: $9/$19 vs $4).
  const plans = read('app/plans/page.tsx');
  for (const price of terms.match(/\$\d+/g) ?? []) assert.ok(plans.includes(price), `terms price ${price} is not on the Plans page`);
});

test('reviewer guide and review page describe the deposit accurately', () => {
  const guide = read('app/reviewer-guide/page.tsx');
  assert.match(guide, /pay it on the review link after approving, through Razorpay Checkout or Stripe Checkout, into the operator’s merchant account/);
  assert.match(guide, /Saving or approving a scope never charges anyone by itself/);
  // changed by WS-07: the client page's copy moved into the message catalog (SF-09); review.tsx renders it.
  const review = read('app/review/[token]/review.tsx') + read('messages/en.json');
  assert.match(review, /Approving or requesting changes does not charge you\. If the scope asks for a deposit, it is paid separately on this page after you approve, through Razorpay or Stripe/);
});

test('the code matches the copy: keys come from the server environment, not the creator', async () => {
  // The copy says the operator configures the account; if per-creator accounts (Route) ever land,
  // this fails and the terms, guide and privacy notice must be updated with it.
  const rz = read('lib/razorpay.ts');
  assert.match(rz, /env\.RAZORPAY_KEY_ID/);
  assert.match(read('lib/stripe.ts'), /env\.STRIPE_SECRET_KEY/);
  const route = read('lib/checkout-server.ts');
  assert.match(route, /razorpayConfig\(\)!/);
  assert.match(route, /stripeConfig\(\)!/);
  assert.doesNotMatch(route + rz + read('lib/stripe.ts'), /account_id|transfers|linked_account|stripe_account|transfer_data|application_fee/i, 'no Razorpay Route or Stripe Connect transfers to creators');
});
