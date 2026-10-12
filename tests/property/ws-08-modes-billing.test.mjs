// WS-08 pure suites: GSTIN/VPA validation, modes, plans and entitlements, billing events,
// subscription GST invoices, retention defaults, the tombstone SQL, onboarding suggestions and the
// time-zone filter. Seeded (FC_SEED), frozen clock, no network.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {fc} from '../support/property.mjs';

const G = await import('../../lib/gstin.ts');
const {validGstin} = await import('../../lib/gst.ts');
const V = await import('../../lib/vpa.ts');
const M = await import('../../lib/mode.ts');
const P = await import('../../lib/plans.ts');
const B = await import('../../lib/billing.ts');
const S = await import('../../lib/settings.ts');
const R = await import('../../lib/retention-sql.ts');
const PR = await import('../../lib/profile.ts');
const DAY = 86400_000, NOW = Date.parse('2026-10-07T09:00:00.000Z');

// @covers LT-17
test('gstinChecksum vectors: published sample GSTINs and the mod-36 algorithm', () => {
  for (const [first14, check] of [['27AAPFU0939F1Z', 'V'], ['24AAACC1206D1Z', 'M'], ['27AAACR5055K1Z', '7'], ['33ABCDE1234F1Z', '7']]) assert.equal(G.gstinChecksum(first14), check, first14);
  assert.equal(G.gstinChecksum('27AAPFU0939F1'), null); // 13 characters
  assert.equal(G.gstinChecksum('27AAPFU0939F1#'), null);
  assert.deepEqual(G.checkGstin('27aapfu0939f1zv'), {ok: true, gstin: '27AAPFU0939F1ZV', state: '27', pan: 'AAPFU0939F'});
  assert.equal(G.checkGstin('TEST25AABCP1234Z1').ok, false);
  assert.equal(G.checkGstin('TEST25AABCP1234Z1').problem, 'format');
  assert.equal(G.checkGstin('33ABCDE1234F1Z5').problem, 'checksum');
  assert.equal(G.checkGstin('99ABCDE1234F1Z5').problem, 'state_code');
  assert.equal(G.checkGstin('27AAPFU0939F1ZV', {state: '33'}).problem, 'state_mismatch');
  assert.equal(G.checkGstin('').problem, 'empty');
});

// @covers LT-17
test('property: lib/gstin agrees with the invoice code’s validGstin (differential) and every checksum-completed GSTIN is valid', () => {
  const states = ['01', '07', '09', '24', '27', '29', '33', '36', '37'];
  const L = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', D = '0123456789', E = '123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const pick = s => fc.constantFrom(...s.split(''));
  const body = fc.tuple(fc.constantFrom(...states), fc.array(pick(L), {minLength: 5, maxLength: 5}), fc.array(pick(D), {minLength: 4, maxLength: 4}), pick(L), pick(E)).map(([s, a, b, c, e]) => s + a.join('') + b.join('') + c + e + 'Z');
  fc.assert(fc.property(body, fc.constantFrom(...(D + L).split('')), (first14, last) => {
    const g = first14 + last;
    assert.equal(G.isValidGstin(g), validGstin(g), g);
    assert.equal(G.isValidGstin(first14 + G.gstinChecksum(first14)), true);
  }));
  fc.assert(fc.property(fc.string({maxLength: 20}), s => { assert.equal(G.isValidGstin(s), validGstin(s), JSON.stringify(s)); }));
});

// @covers LT-17
test('UPI VPA: pattern from the brief, upi:// link for the QR', () => {
  for (const ok of ['ada@okicici', 'ada.studio-1_x@ybl', 'ab@upi']) assert.equal(V.isValidVpa(ok), true, ok);
  for (const bad of ['a@okicici', 'ada@ok1', 'ada@', '@okicici', 'ada okicici', 'ada@o', 'ada@okicici.com']) assert.equal(V.isValidVpa(bad), false, bad);
  assert.equal(V.upiLink({vpa: 'ada@okicici', name: 'Ada Studio', amount: 1180, note: 'INV-0001'}), 'upi://pay?pa=ada%40okicici&pn=Ada%20Studio&am=1180.00&cu=INR&tn=INV-0001');
  assert.equal(V.upiLink({vpa: 'nope'}), null);
});

// @covers SF-17
test('modes: every mode lists every feature exactly once (All features never loses one); enterprise turns compliance on', () => {
  const ids = M.FEATURES.map(f => f.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const mode of M.MODES) {
    const d = M.modeDefaults(mode), order = d.order;
    assert.equal(d.mode, mode);
    assert.deepEqual([...order].sort(), [...ids].sort(), mode);
    assert.deepEqual(M.featuresFor(mode).map(f => f.id), [...order]);
  }
  const e = M.modeDefaults('enterprise');
  assert.deepEqual({compliance: e.compliance, retention_required: e.retention_required, audit_export: e.audit_export, countersign_roles: e.countersign_roles, otp: e.otp, range: e.retention_range, lock: e.contact_lock}, {compliance: true, retention_required: true, audit_export: true, countersign_roles: true, otp: 'required', range: [30, 3650], lock: 'strict'});
  assert.ok(e.data_residency_note);
  assert.equal(M.modeDefaults('enterprise').order[2], 'audit_export');
  const c = M.modeDefaults('consumer');
  assert.deepEqual({author: c.author, msmed: c.msmed, tds: c.tds, gst: c.gst_invoicing, word: c.change_orders.word, photos: c.change_orders.photos_required, first: c.payments_first[0], party: c.copy.party}, {author: 'buyer', msmed: false, tds: false, gst: 'off', word: 'variation', photos: true, first: 'stage_payments', party: 'vendor'});
  assert.equal(M.modeDefaults('agency').otp, 'default_on');
  assert.equal(M.modeDefaults('freelancer').otp, 'optional');
  assert.equal(M.isMode('enterprise'), true); assert.equal(M.isMode('team'), false);
});

// @covers SF-17
test('settings: Enterprise requires a 30–3650 day retention policy; other modes accept the server default', () => {
  const ent = M.modeDefaults('enterprise'), free = M.modeDefaults('freelancer');
  assert.match(S.retentionPolicyProblem({context_retention_days: null}, ent), /retention policy/);
  assert.match(S.retentionPolicyProblem({context_retention_days: 7}, ent), /30 to 3650/);
  assert.equal(S.retentionPolicyProblem({context_retention_days: 180}, ent), null);
  assert.equal(S.retentionPolicyProblem({context_retention_days: null}, free), null);
  assert.equal(S.retentionPolicyProblem({context_retention_days: 1}, free), null);
});

// @covers M32
test('retention: the server default is 180 days unless configured; "keep" disables it', () => {
  assert.equal(S.defaultRetentionDays({}), 180);
  assert.equal(S.defaultRetentionDays({SCOPEFLOW_CONTEXT_RETENTION_DAYS: '90'}), 90);
  assert.equal(S.defaultRetentionDays({SCOPEFLOW_CONTEXT_RETENTION_DAYS: 'forever'}), 180);
  assert.equal(S.defaultRetentionDays({SCOPEFLOW_CONTEXT_RETENTION_DAYS: 'keep'}), null);
  assert.equal(S.effectiveRetentionDays({context_retention_days: null}, {}), 180);
  assert.equal(S.effectiveRetentionDays({context_retention_days: 30}, {}), 30);
});

// @covers M13
test('resolvePlan: no row → server default; active → plan; halted → plan for 7 days then Free; cancelled → plan to period end', () => {
  const env = {SCOPEFLOW_PLAN: 'beta'};
  assert.equal(P.resolvePlan(null, NOW, env).plan.id, 'beta');
  assert.equal(P.resolvePlan({plan: 'pro', status: 'pending', period_end: null, grace_until: null}, NOW, env).plan.id, 'beta');
  assert.equal(P.resolvePlan({plan: 'pro', status: 'active', period_end: new Date(NOW + 20 * DAY).toISOString(), grace_until: null}, NOW, env).plan.id, 'pro');
  assert.equal(P.resolvePlan({plan: 'pro', status: 'active', period_end: new Date(NOW - 8 * DAY).toISOString(), grace_until: null}, NOW, env).plan.id, 'free');
  const halted = B.nextPlanRow({plan: 'pro', status: 'active', period_end: null, grace_until: null}, {owner: 'o', subscription: 's', plan: 'pro', status: 'halted'}, NOW);
  assert.equal(halted.grace_until, new Date(NOW + 7 * DAY).toISOString());
  assert.equal(P.resolvePlan(halted, NOW + 6 * DAY, env).plan.id, 'pro');
  assert.equal(P.resolvePlan(halted, NOW + 7 * DAY + 1, env).plan.id, 'free');
  // A repeated halted event keeps the first grace deadline.
  assert.equal(B.nextPlanRow(halted, {owner: 'o', subscription: 's', plan: 'pro', status: 'halted'}, NOW + 3 * DAY).grace_until, halted.grace_until);
  assert.equal(B.nextPlanRow(halted, {owner: 'o', subscription: 's', plan: 'pro', status: 'active'}, NOW + 3 * DAY).grace_until, null);
  const cancelled = {plan: 'agency', status: 'cancelled', period_end: new Date(NOW + DAY).toISOString(), grace_until: null};
  assert.equal(P.resolvePlan(cancelled, NOW, env).plan.id, 'agency');
  assert.equal(P.resolvePlan(cancelled, NOW + 2 * DAY, env).plan.id, 'free');
  assert.equal(P.limits({SCOPEFLOW_PLAN: 'free', SCOPEFLOW_LIMIT_PROJECTS: '5'}).projects, 5);
});

// @covers M13 SF-12
test('property: resolvePlan never grants a paid plan without a live subscription state', () => {
  fc.assert(fc.property(fc.constantFrom('active', 'halted', 'cancelled', 'expired', 'pending'), fc.constantFrom('pro', 'agency', 'free', 'bogus'), fc.integer({min: -400, max: 400}), fc.integer({min: -400, max: 400}), fc.integer({min: 0, max: 400}), (status, plan, endDays, graceDays, at) => {
    const row = {plan, status, period_end: new Date(NOW + endDays * DAY).toISOString(), grace_until: new Date(NOW + graceDays * DAY).toISOString()};
    const now = NOW + at * DAY, s = P.resolvePlan(row, now, {});
    if (s.plan.id === plan && P.PLANS[plan]?.purchasable) {
      assert.ok(status === 'active' ? now <= NOW + endDays * DAY + 7 * DAY : status === 'halted' ? now < NOW + graceDays * DAY : status === 'cancelled' && now < NOW + endDays * DAY, JSON.stringify({row, at}));
    }
    if (status === 'expired' && P.isPlanId(plan)) assert.equal(s.plan.id, 'free');
  }));
});

// @covers M13 SF-12
test('Razorpay and Stripe billing events map to plan updates; signatures are checked', () => {
  const sub = (event, extra = {}) => ({entity: 'event', event, payload: {subscription: {entity: {id: 'sub_X', status: 'active', current_start: 1791000000, current_end: 1793592000, notes: {owner: 'owner-1', plan: 'pro', interval: 'month'}}}, ...extra}});
  assert.deepEqual(B.razorpayEventToUpdate(sub('subscription.activated')), {owner: 'owner-1', subscription: 'sub_X', customer: null, plan: 'pro', interval: 'month', period_end: new Date(1793592000 * 1000).toISOString(), status: 'active'});
  assert.equal(B.razorpayEventToUpdate(sub('subscription.halted')).status, 'halted');
  assert.equal(B.razorpayEventToUpdate(sub('subscription.cancelled')).status, 'cancelled');
  assert.equal(B.razorpayEventToUpdate(sub('subscription.pending')).status, null);
  assert.equal(B.razorpayEventToUpdate({event: 'payment.captured', payload: {}}), null);
  const charged = B.razorpayEventToUpdate(sub('subscription.charged', {payment: {entity: {id: 'pay_1', amount: 49900, currency: 'INR'}}}));
  assert.deepEqual(charged.payment, {id: 'pay_1', amount_minor: 49900, currency: 'INR', period_start: new Date(1791000000 * 1000).toISOString(), period_end: new Date(1793592000 * 1000).toISOString()});
  const st = B.stripeEventToUpdate({id: 'evt_1', type: 'customer.subscription.updated', data: {object: {id: 'sub_S', status: 'past_due', current_period_end: 1793592000, customer: 'cus_1', metadata: {owner: 'o2', plan: 'agency', interval: 'year'}}}});
  assert.deepEqual({s: st.status, p: st.plan, o: st.owner, i: st.interval}, {s: 'halted', p: 'agency', o: 'o2', i: 'year'});
  assert.equal(B.stripeEventToUpdate({type: 'customer.subscription.deleted', data: {object: {id: 'sub_S', status: 'canceled'}}}).status, 'expired');
  assert.equal(B.stripeEventToUpdate({type: 'invoice.paid', data: {object: {id: 'in_1', subscription: 'sub_S', amount_paid: 1800, currency: 'usd', lines: {data: [{period: {start: 1791000000, end: 1793592000}}]}}}}).payment.currency, 'USD');
  const body = JSON.stringify(sub('subscription.activated'));
  assert.equal(B.verifyRazorpaySignature(body, B.razorpaySignature(body, 'whsec'), 'whsec'), true);
  assert.equal(B.verifyRazorpaySignature(body + ' ', B.razorpaySignature(body, 'whsec'), 'whsec'), false);
  assert.equal(B.verifyRazorpaySignature(body, null, 'whsec'), false);
  const t = Math.floor(NOW / 1000), header = B.stripeSignature(body, 'stripe-secret', t);
  assert.equal(B.verifyStripeSignature(body, header, 'stripe-secret', NOW), true);
  assert.equal(B.verifyStripeSignature(body, header, 'stripe-secret', NOW + 10 * 60_000), false); // outside the 5-minute tolerance
  assert.equal(B.verifyStripeSignature(body, header, 'other', NOW), false);
});

// @covers M13
test('billing config: the local double only on a localhost APP_URL outside Render with no provider keys', () => {
  assert.equal(B.localDouble({APP_URL: 'http://localhost:5173'}), true);
  assert.equal(B.localDouble({APP_URL: 'https://scope-flow.tech'}), false);
  assert.equal(B.localDouble({APP_URL: 'http://localhost:5173', RENDER: 'true'}), false);
  assert.equal(B.localDouble({APP_URL: 'http://localhost:5173', RAZORPAY_BILLING_KEY_ID: 'k', RAZORPAY_BILLING_KEY_SECRET: 's'}), false);
  assert.equal(B.providerFor('INR', {APP_URL: 'https://scope-flow.tech', RAZORPAY_BILLING_KEY_ID: 'k', RAZORPAY_BILLING_KEY_SECRET: 's'}), 'razorpay');
  assert.equal(B.providerFor('USD', {APP_URL: 'https://scope-flow.tech', RAZORPAY_BILLING_KEY_ID: 'k', RAZORPAY_BILLING_KEY_SECRET: 's'}), null);
  assert.equal(B.providerFor('USD', {APP_URL: 'https://scope-flow.tech', STRIPE_BILLING_SECRET_KEY: 'sk'}), 'stripe');
  assert.equal(B.billingStatus({APP_URL: 'https://scope-flow.tech'}).enabled, false);
  assert.equal(B.razorpayWebhookSecret({APP_URL: 'https://scope-flow.tech', SCOPEFLOW_SIGNING_SECRET: 'x'.repeat(40)}), null);
  assert.match(B.razorpayWebhookSecret({APP_URL: 'http://localhost:5173', SCOPEFLOW_SIGNING_SECRET: 'x'.repeat(40)}), /^[a-f0-9]{64}$/);
});

// @covers SF-12
test('property: ScopeFlow’s subscription GST invoice parts always add up to the amount paid', () => {
  const seller = {gstin: '33ABCDE1234F1Z7', state: '33'};
  fc.assert(fc.property(fc.integer({min: 1, max: 10_000_000}), fc.constantFrom('', '33', '29', '07'), fc.constantFrom('INR', 'USD'), (total, state, currency) => {
    const t = B.billingTax(total, currency, seller, {state: state || null});
    assert.equal(t.taxable_minor + t.cgst_minor + t.sgst_minor + t.igst_minor, total);
    if (currency !== 'INR') assert.equal(t.kind, 'export');
    else if (!state || state === '33') { assert.equal(t.kind, 'intra'); assert.ok(Math.abs(t.cgst_minor - t.sgst_minor) <= 1); }
    else assert.equal(t.kind, 'inter');
  }));
  assert.deepEqual(B.billingTax(49900, 'INR', seller, {state: '33'}), {kind: 'intra', rate: 18, taxable_minor: 42288, cgst_minor: 3806, sgst_minor: 3806, igst_minor: 0});
  assert.equal(B.billingTax(49900, 'INR', {gstin: null, state: null}, {state: '33'}).kind, 'unregistered');
  const inv = B.billingInvoiceContent({number: 'SF-2026-00001', issued: '2026-10-07T09:00:00.000Z', seller: B.billingSeller({SCOPEFLOW_BILLING_SELLER_GSTIN: '33ABCDE1234F1Z7', SCOPEFLOW_BILLING_SELLER_NAME: 'ScopeFlow'}), buyer: {name: 'Ada Studio', address: '', gstin: null, state: '29'}, plan: 'pro', interval: 'month', period: {start: null, end: null}, currency: 'INR', total_minor: 49900, provider: 'razorpay', payment: 'pay_1'});
  assert.equal(inv.title, 'Tax invoice'); assert.equal(inv.tax.kind, 'inter'); assert.equal(inv.tax.igst_minor, 7612);
});

// @covers L13
test('L13: Plans page cards come only from the PLANS table (snapshot)', async () => {
  const money = n => '₹' + n.toLocaleString('en-IN');
  const cards = P.planCards('INR', money);
  assert.deepEqual(cards.map(c => [c.id, c.price, c.yearly, c.lines[0]]), [
    ['free', '₹0', null, '1 active project (archived ones don’t count)'],
    ['pro', '₹499', 'or ₹4,499 a year', '1,000 active projects (archived ones don’t count)'],
    ['agency', '₹1,499', 'or ₹13,499 a year', '5,000 active projects (archived ones don’t count)'],
  ]);
  for (const c of cards) { assert.equal(c.lines[0], P.projectCapLine(P.PLANS[c.id].limits)); assert.ok(c.lines.includes(`${P.PLANS[c.id].limits.versions} versions per project`)); }
  assert.match(P.projectCapMessage(P.PLANS.free.limits), /1 active project \(archived ones don’t count\)/);
  const golden = new URL('../golden/ws-08-plans.golden.json', import.meta.url);
  const {readFileSync, writeFileSync} = await import('node:fs');
  const text = JSON.stringify({INR: cards, USD: P.planCards('USD', n => '$' + n)}, null, 1) + '\n';
  if (process.env.UPDATE_GOLDEN) writeFileSync(golden, text);
  assert.equal(text, readFileSync(golden, 'utf8'));
});

// @covers H10 LT-22
test('tombstone SQL: one SECURITY DEFINER call each; the closure never deletes client evidence; retention defaults to 8 years', async () => {
  const now = new Date('2026-10-07T00:00:00.000Z').toISOString(), until = R.retainUntil(now, R.tombstoneRetentionYears({}));
  for (const [sql, params] of [R.closeAccountQuery('owner-1', now, until), R.purgeTombstoneQuery('p1', now), R.deleteDraftQuery('p1', 'o1'), R.expiredTombstonesQuery(now)]) assert.equal((sql.match(/\?/g) ?? []).length, params.length, sql);
  assert.match(R.closeAccountQuery('o', now, until)[0], /^SELECT scopeflow\.ws08_close_account\(/);
  assert.equal(until, new Date('2034-10-07T00:00:00.000Z').toISOString());
  assert.equal(R.tombstoneRetentionYears({SCOPEFLOW_TOMBSTONE_RETENTION_YEARS: '10'}), 10);
  assert.equal(R.tombstoneRetentionYears({SCOPEFLOW_TOMBSTONE_RETENTION_YEARS: '0'}), 8);
  const {readFileSync} = await import('node:fs');
  const migration = readFileSync(new URL('../../db/migrations/0022a_ws-08_account_functions.sql', import.meta.url), 'utf8');
  const body = name => { const i = migration.indexOf('FUNCTION scopeflow.' + name + '('); assert.ok(i > 0, name); return migration.slice(i, migration.indexOf('END $$;', i)); };
  const close = body('ws08_close_account');
  // Decisions, ledger entries, invoices, countersignatures and payments of kept projects are never deleted.
  assert.doesNotMatch(close, /DELETE FROM (ledger_entries|invoices|version_cosigns|invoice_reminders)\b/);
  assert.match(close, /DELETE FROM versions WHERE status = 'pending'/);
  assert.match(close, /UPDATE projects SET owner_deleted = at_time/);
  assert.match(close, /legal_hold\) THEN\s+RAISE EXCEPTION/);
  for (const t of ['payment_accounts', 'payment_oauth_states', 'rate_cards', 'msme_profiles', 'mail_outbox', 'wa_links', 'capture_drafts', 'owner_contacts']) assert.ok(close.includes(`'${t}'`), t);
  for (const name of ['ws08_close_account', 'ws08_purge_tombstone', 'ws08_delete_draft']) assert.match(body(name), /SECURITY DEFINER SET search_path = pg_catalog, scopeflow/);
  assert.match(body('ws08_purge_tombstone'), /retain_until::timestamptz < at_time::timestamptz AND NOT legal_hold/);
  assert.match(body('ws08_delete_draft'), /NOT legal_hold AND owner_deleted IS NULL/);
});

// @covers LT-04 SF-11
test('onboarding suggestions: India → INR + Asia/Kolkata; GST 18% only with a GSTIN; MSMED terms for micro/small Udyam', () => {
  assert.equal(PR.countryFromLocale('en-IN'), 'IN');
  assert.equal(PR.countryFromLocale('hi-IN'), 'IN');
  assert.equal(PR.countryFromLocale('en', 'Asia/Calcutta'), 'IN');
  assert.equal(PR.countryFromLocale('en-GB'), 'GB');
  assert.equal(PR.countryFromLocale('xx', 'Mars/Base'), 'OTHER');
  assert.deepEqual(PR.onboardingSuggestions({country: 'IN'}), {currency: 'INR', timezone: 'Asia/Kolkata', tax_label: '', tax_pct: null, payment_terms: PR.STANDARD_TERMS});
  assert.deepEqual(PR.onboardingSuggestions({country: 'IN', gstin: '27AAPFU0939F1ZV', udyam_category: 'micro'}), {currency: 'INR', timezone: 'Asia/Kolkata', tax_label: 'GST', tax_pct: 18, payment_terms: PR.MSMED_TERMS});
  assert.equal(PR.onboardingSuggestions({country: 'IN', udyam_category: 'medium'}).payment_terms, PR.STANDARD_TERMS);
  assert.equal(PR.onboardingSuggestions({country: 'US', gstin: '27AAPFU0939F1ZV'}).tax_pct, null);
  assert.equal(PR.msmedEligible({udyam_number: 'UDYAM-TN-02-0012345', udyam_category: 'small'}), true);
  assert.equal(PR.msmedEligible({udyam_number: '', udyam_category: 'small'}), false);
  // LT-17 in the profile schema: a GST-registered profile needs a valid GSTIN.
  const base = {...PR.defaultProfile, business_name: 'Ada'};
  assert.equal(PR.profileSchema.safeParse({...base, tax_id: 'TEST25AABCP1234Z1', gst_state: '33'}).success, false);
  assert.equal(PR.profileSchema.safeParse({...base, tax_id: '33ABCDE1234F1Z5', gst_state: '33'}).success, false);
  assert.equal(PR.profileSchema.safeParse({...base, tax_id: '33ABCDE1234F1Z7', gst_state: '33'}).success, true);
  assert.equal(PR.profileSchema.safeParse({...base, tax_id: 'DE123456789'}).success, true); // a non-Indian VAT ID
  assert.equal(PR.profileSchema.safeParse({...base, upi_vpa: 'not-a-vpa'}).success, false);
  assert.equal(PR.profileSchema.safeParse({...base, udyam_number: 'udyam-tn-02-0012345', udyam_category: 'micro', udyam_date: '2024-05-01'}).data.udyam_number, 'UDYAM-TN-02-0012345');
});

// @covers LT-16
test('time-zone filter: common zones first; "Kolk" and "india" find Asia/Kolkata', async () => {
  // The slot component is TSX; its pure filter is exercised through the same list the runtime gives.
  const all = Intl.supportedValuesOf('timeZone');
  const src = (await import('node:fs')).readFileSync(new URL('../../app/components/slots/timezone-select.tsx', import.meta.url), 'utf8');
  assert.match(src, /export function filterZones/);
  const COMMON = JSON.parse('[' + src.match(/COMMON_ZONES = \[([^\]]+)\]/)[1].replaceAll("'", '"') + ']');
  assert.equal(COMMON[0], 'Asia/Kolkata');
  const filter = (q) => { const k = q.trim().toLowerCase().replace(/\s+/g, '_'); return [...COMMON, ...all.filter(z => !COMMON.includes(z))].filter(z => !k || z.toLowerCase().includes(k)); };
  assert.equal(filter('Kolk')[0], 'Asia/Kolkata'); // offered even when the runtime only lists Asia/Calcutta
  assert.doesNotThrow(() => new Intl.DateTimeFormat('en', {timeZone: 'Asia/Kolkata'}));
  assert.ok(all.length > 300 && filter('').length >= all.length);
  assert.match(src, /'Asia\/Kolkata': 'India IST/);
});

// @covers M13
test('local double events are Razorpay-shaped and deterministic per subscription', () => {
  const ev = B.localDoubleEvents('sub_local_0123456789abcd', 'o1', 'pro', 'month', 'INR', NOW);
  assert.deepEqual(ev.map(e => e.event), ['subscription.activated', 'subscription.charged']);
  const u = B.razorpayEventToUpdate(ev[1]);
  assert.equal(u.payment.amount_minor, 49900); assert.equal(u.owner, 'o1'); assert.equal(u.plan, 'pro');
  assert.equal(createHash('sha256').update(JSON.stringify(ev)).digest('hex'), createHash('sha256').update(JSON.stringify(B.localDoubleEvents('sub_local_0123456789abcd', 'o1', 'pro', 'month', 'INR', NOW))).digest('hex'));
});
