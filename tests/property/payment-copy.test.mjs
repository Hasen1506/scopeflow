// Payment copy regression (pure, no server). Razorpay deposits are merged (PR F, #12), so no page
// may still claim that Scopeflow takes no payments, and the pages that describe money must say what
// the code does: Scopeflow charges creators nothing; a client can pay a creator-set deposit on the
// review link, after approving, through Razorpay Checkout, into the Razorpay account configured by
// the server operator (RAZORPAY_KEY_ID/SECRET in lib/razorpay.ts), with no payouts to creators.
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

test('terms: Scopeflow is free; client deposits go through Razorpay to the operator-configured account', () => {
  const terms = read('app/terms/page.tsx');
  assert.match(terms, /Scopeflow itself is free during this beta/);
  assert.match(terms, /<h2>Client deposits<\/h2>/);
  assert.match(terms, /through Razorpay Checkout/);
  assert.match(terms, /Razorpay merchant account the server operator configured, not to an account of the creator/);
  assert.match(terms, /does not connect creators’ own payment accounts, pay deposits out to creators, or handle refunds/);
  assert.match(terms, /only after Razorpay confirms it/);
  // Prices are not repeated in the terms (they had drifted from the Plans page: $9/$19 vs $4).
  const plans = read('app/plans/page.tsx');
  for (const price of terms.match(/\$\d+/g) ?? []) assert.ok(plans.includes(price), `terms price ${price} is not on the Plans page`);
});

test('reviewer guide and review page describe the deposit accurately', () => {
  const guide = read('app/reviewer-guide/page.tsx');
  assert.match(guide, /pay that deposit on the review link after approving, through Razorpay Checkout, into the operator’s Razorpay account/);
  assert.match(guide, /Saving or approving a scope never charges anyone by itself/);
  const review = read('app/review/[token]/review.tsx');
  assert.match(review, /Approving or requesting changes does not charge you\. If the scope asks for a deposit, it is paid separately on this page after you approve, through Razorpay/);
});

test('the code matches the copy: keys come from the server environment, not the creator', async () => {
  // The copy says the operator configures the account; if per-creator accounts (Route) ever land,
  // this fails and the terms, guide and privacy notice must be updated with it.
  const rz = read('lib/razorpay.ts');
  assert.match(rz, /env\.RAZORPAY_KEY_ID/);
  const route = read('app/api/review/[token]/deposit/route.ts');
  assert.match(route, /const config = razorpayConfig\(\);/);
  assert.doesNotMatch(route + rz, /account_id|transfers|linked_account/i, 'no Razorpay Route transfers to creators');
});
