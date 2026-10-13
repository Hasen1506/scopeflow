// UX round 2a (re-audit N1–N9, UX-C43 and visual #2/#9/#16): the last native confirm, env-var names in API errors
// the UI renders, copy-only "Copy link to send", unique row names, the "1 second" plural, operator-only billing
// detail, the brand-name colour, money that never wraps and prices that never read as unit prices.
// Pure rules plus source guards. Seeded, no network.
import '../support/fc-setup.mjs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, readdirSync, statSync} from 'node:fs';
import {join} from 'node:path';
import {fc} from '../support/property.mjs';

const a11y = await import('../../lib/a11y.ts');
const otp = await import('../../lib/otp.ts');
const billing = await import('../../lib/billing.ts');
const theme = await import('../../lib/theme.ts');
const money = await import('../../lib/money.ts');
const {reviewMailto} = await import('../../lib/review-link-copy.ts');
const root = new URL('../../', import.meta.url).pathname;
const src = f => readFileSync(join(root, f), 'utf8');
const code = f => src(f).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const walk = (d, re, out = []) => { for (const n of readdirSync(join(root, d))) { const p = join(d, n); if (statSync(join(root, p)).isDirectory()) walk(p, re, out); else if (re.test(p)) out.push(p); } return out; };
const ENV = /\b(?:SCOPEFLOW|RESEND|STRIPE|RAZORPAY|OPENAI|ANTHROPIC|VOYAGE|POSTMARK|MSG91|TWILIO|NEON|DATABASE)_[A-Z0-9_]+\b/;
const LIT = /'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\.)*`/g;

test('N1: no native confirm or prompt is left in any page or component; replacing a draft awaits the in-app dialog', () => {
  const offenders = walk('app', /\.tsx$/).filter(f => /window\.(confirm|prompt)\(/.test(code(f)));
  assert.deepEqual(offenders, []);
  const state = src('app/workspace/state.tsx');
  assert.match(state, /async function canReplace\(\)\{return !dirty\|\|await confirm\(\{title:'Replace this unsaved draft\?'/);
  for (const caller of ['async function newScope(){if(!(await canReplace()))', "async function select(s:Version,then?:'revise'|'change_order'){if(!(await canReplace()))", 'if(!(await canReplace()))return;stash();creationRequest.current=null;setDraft(value)']) assert.ok(state.includes(caller), caller);
  assert.ok(!/[^.]\bnewScope\(\)\)/.test(state.replace(/await newScope\(\)\)/g, '')), 'every newScope() result is awaited');
});

test('N2/N3 + B-4: API error strings the UI renders name no env var (machine-facing webhooks and cron excepted)', () => {
  const machine = /webhook|mail\/events|notify\/drain|reconcile|openapi|readiness|health|cron/;
  const leaks = [];
  for (const f of walk('app/api', /route\.ts$/)) {
    if (machine.test(f)) continue;
    for (const m of code(f).matchAll(LIT)) if (ENV.test(m[0])) leaks.push(`${f}: ${m[0].slice(0, 80)}`);
  }
  // Errors thrown as BillingError are sent verbatim by /api/billing/checkout and shown by app/plans/upgrade.tsx.
  for (const m of code('lib/billing.ts').matchAll(/new BillingError\(([^;]*?), \d{3}, '/g)) if (ENV.test(m[1])) leaks.push('lib/billing.ts: ' + m[1].slice(0, 80));
  assert.deepEqual(leaks, []);
});

test('N2: the plan-missing checkout error is neutral; the env name goes to the server log only', () => {
  assert.doesNotMatch(billing.BILLING_UNAVAILABLE, ENV);
  assert.match(billing.BILLING_UNAVAILABLE, /isn’t on sale yet/);
  const b = code('lib/billing.ts');
  assert.match(b, /billingUnavailable\(`Set RAZORPAY_BILLING_PLAN_/);
  assert.match(b, /billingUnavailable\(`Set STRIPE_BILLING_PRICE_/);
  assert.match(b, /console\.warn\('\[billing\] checkout unavailable: ' \+ operatorDetail\)/);
});

test('N3: the one-time-code unavailable message names no env var or vendor on any channel', () => {
  for (const c of ['email', 'sms', 'whatsapp']) {
    const m = otp.otpUnavailableMessage(c);
    assert.doesNotMatch(m, ENV); assert.doesNotMatch(m, /MSG91|Twilio|Resend|Set /i);
  }
  assert.equal(otp.otpUnavailableMessage('email'), 'Codes can’t be sent by email on this server yet.');
  assert.ok(src('app/api/scopes/[id]/route.ts').includes("json({error:otpUnavailableMessage(channel),code:'otp_unavailable'},409)"));
});

test('N4: "Copy link to send" copies only (no /send call) and builds the mail-app draft locally', () => {
  const state = src('app/workspace/state.tsx');
  const fn = state.slice(state.indexOf('async function copyLinkToSend'), state.indexOf('async function copyReviewLink'));
  assert.ok(fn.length > 0);
  assert.doesNotMatch(fn, /sendForSignature|\/send|setNotice/);
  assert.match(fn, /reviewMailto\(/);
  const url = 'https://scope.example/review/abc';
  const m = reviewMailto('ana@example.com', {title: 'Site\nrefresh', client: 'Northwind', version: 2, reviewUrl: url});
  assert.ok(m.startsWith('mailto:ana%40example.com?subject='));
  const body = decodeURIComponent(m.split('&body=')[1]), subject = decodeURIComponent(m.split('?subject=')[1].split('&body=')[0]);
  assert.equal(subject, 'Please review and approve: Site refresh (version 2)');
  assert.ok(body.includes(url) && body.startsWith('Hi Northwind,'));
});

test('UX-C43: a button with aria-disabled=true looks disabled and gets no hover or press effect', () => {
  const css = code('app/globals.css');
  assert.match(css, /button\[aria-disabled=true\]\{opacity:\.5;cursor:not-allowed\}/);
  assert.match(css, /\.primary:hover:not\(:disabled\):not\(\[aria-disabled=true\]\)/);
});

test('N5: the business name uses the owner text colour first, always contrast-checked, never raw', () => {
  for (const bg of ['#ffffff', '#111111', '#f6f1e7']) {
    const ink = theme.brandNameInk('#777777', '#ff0000', bg);
    assert.ok(ink && theme.contrastRatio(theme.parseColor(ink), theme.parseColor(bg)) >= 4.5, `${ink} on ${bg}`);
  }
  assert.equal(theme.brandNameInk('#000000', '#ff0000', '#ffffff'), '#000000', 'a readable text colour is used as chosen');
  assert.equal(theme.brandNameInk(null, null, '#ffffff'), null);
  const review = src('app/review/[token]/review.tsx');
  assert.ok(review.includes('text: brandNameInk(textColor, color, bg)'));
  assert.doesNotMatch(review, /\?\? brand\?\.text_color/);
});

test('N6: per-row Remove / Due date names are unique, even for untitled or repeated titles', () => {
  assert.equal(a11y.rowName(['', ''], 1, 'untitled item'), 'untitled item 2');
  assert.equal(a11y.rowName(['Logo', 'Logo', 'Site'], 0, 'untitled item'), 'Logo (1)');
  assert.equal(a11y.rowName(['Logo', 'Logo', 'Site'], 2, 'untitled item'), 'Site');
  fc.assert(fc.property(fc.array(fc.constantFrom('', ' ', 'Logo', 'Site', 'Logo '), {maxLength: 8}), titles => {
    const names = titles.map((_, i) => a11y.rowName(titles, i, 'untitled item'));
    assert.equal(new Set(names).size, names.length);
  }));
  const items = src('app/items-editor.tsx');
  assert.doesNotMatch(items, /Remove \$\{item\.title \|\| 'deliverable'\}|Remove \$\{input\.title \|\| 'client input'\}/);
});

test('N7: the credit-note dialog ignores close while issuing and resets when reopened', () => {
  const p = src('app/invoice-panel.tsx');
  assert.ok(p.includes('onOpenChange={o => { if (!o && !busy) onCancel(); }}'));
  assert.ok(p.includes('onEscapeKeyDown={e => { if (busy) e.preventDefault(); }}') && p.includes('onInteractOutside={e => { if (busy) e.preventDefault(); }}'));
  assert.ok(p.includes("if (invoice && (invoice !== shown || !wasOpen)) { setShown(invoice); setReason('');"));
});

test('N8: the retry countdown has a singular form in every language', () => {
  for (const lang of ['en', 'hi', 'ta']) {
    const cat = JSON.parse(src(`messages/${lang}.json`));
    assert.ok(cat['decide.retryInOne']?.includes('{seconds}'), `${lang} retryInOne`);
  }
  assert.equal(JSON.parse(src('messages/en.json'))['decide.retryInOne'], 'You can try again in {seconds} second.');
  assert.ok(src('app/review/[token]/review.tsx').includes("t(cooldown === 1 ? 'decide.retryInOne' : 'decide.retryIn', {seconds: cooldown})"));
});

test('N9: the operator billing note is keyed on admin emails or an explicit opt-in, never NODE_ENV', () => {
  const page = code('app/plans/page.tsx');
  const fn = page.slice(page.indexOf('async function operatorView'), page.indexOf('export default'));
  assert.doesNotMatch(fn, /NODE_ENV/);
  assert.match(fn, /SCOPEFLOW_DEV_OPERATOR === '1'/);
  assert.match(fn, /SCOPEFLOW_ADMIN_EMAILS/);
});

test('visual #2: money figures never break mid-number on the review page or the workspace', () => {
  const css = code('app/globals.css');
  assert.match(css, /\.scope-stats strong,\.summary-strip strong,\.pay-grid dd,\.terms-line strong,\.item-price\{white-space:nowrap;overflow-wrap:normal;word-break:normal\}/);
});

test('visual #9: a price shows the line total; a unit price says "each"; a legacy line price says "for all N"', () => {
  assert.deepEqual(money.itemPriceView({qty: 12, price: null, unit_price: 2500}, 'INR'), {line: 30000, each: 2500, forAll: null});
  assert.deepEqual(money.itemPriceView({qty: 12, price: 2500}, 'INR'), {line: 2500, each: null, forAll: 12});
  assert.deepEqual(money.itemPriceView({qty: 1, price: 900}, 'USD'), {line: 900, each: null, forAll: null});
  assert.equal(money.itemPriceView({qty: 3, price: null}, 'USD'), null);
  fc.assert(fc.property(fc.integer({min: 1, max: 500}), fc.integer({min: 0, max: 10000}), (qty, unit) => {
    const v = money.itemPriceView({qty, price: null, unit_price: unit}, 'USD');
    assert.equal(v.line, money.lineTotal({qty, price: null, unit_price: unit}, 'USD'));
    assert.equal(v.each, qty > 1 ? unit : null);
  }));
  for (const lang of ['en', 'hi', 'ta']) {
    const cat = JSON.parse(src(`messages/${lang}.json`));
    assert.ok(cat['doc.priceEach'].includes('{amount}') && cat['doc.priceForAll'].includes('{qty}'), lang);
  }
  for (const f of ['app/ui.tsx', 'app/review/[token]/scope-document.tsx']) assert.ok(src(f).includes('itemPriceView(i'), f);
});

test('visual #16: the approval card shows the current review link (Open, Copy) whenever the version has a live link', () => {
  const a = src('app/workspace/approval.tsx');
  assert.ok(a.includes("const reviewLink=link||(active&&!active.revoked&&typeof location!=='undefined'?location.origin+'/review/'+active.token:'');"));
  assert.ok(a.includes('{reviewLink&&<div className="muted-box"><label>Review link<input readOnly value={reviewLink}'));
  assert.ok(a.includes('href={reviewLink} target="_blank"'));
});
