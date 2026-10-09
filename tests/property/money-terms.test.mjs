// Money terms (pure): GSTIN checks and the CGST/SGST/IGST split, amounts in words, place of supply,
// tax invoice content, the payment schedule, the locked exchange rate, Net-X, invoice payment
// status and reminders, the revision bank, reference-rate parsing and Razorpay order lookups.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fc} from '../support/property.mjs';

const G = await import('../../lib/gst.ts');
const I = await import('../../lib/invoice.ts');
const S = await import('../../lib/invoice-status.ts');
const M = await import('../../lib/money.ts');
const {scopeSchema} = await import('../../lib/scope.ts');
const L = await import('../../lib/ledger.ts');
const FX = await import('../../lib/fx.ts');
const R = await import('../../lib/razorpay.ts');
const approvedScope = extra => ({baseline: scopeSchema.parse({title: 'Bank check', client: 'Acme', deliverables: 'Some work', exclusions: '', fee: 1000, currency: 'INR', revisions: 2, due: '', notes: '', ...extra})});

test('GSTIN: check digit, shape and state', () => {
  // Published sample GSTINs with valid check digits.
  for (const g of ['27AAPFU0939F1ZV', '29AAGCB7383J1Z4']) { assert.equal(G.validGstin(g), true, g); assert.equal(G.validGstin(g.toLowerCase()), true); }
  assert.equal(G.validGstin('27AAPFU0939F1ZW'), false); // wrong check digit
  assert.equal(G.validGstin('99AAPFU0939F1ZV'), false); // no such state
  assert.equal(G.gstinState('33ABCDE1234F1Z5'), '33'); // shape only, check digit not required
  assert.equal(G.gstinState('33ABCDE1234F1Y5'), '');
  assert.equal(G.gstinState(''), '');
  // Any single changed character breaks the check digit.
  fc.assert(fc.property(fc.integer({min: 2, max: 13}), fc.constantFrom(...'0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ'), (i, ch) => {
    const g = '27AAPFU0939F1ZV';
    if (g[i] === ch) return;
    assert.equal(G.validGstin(g.slice(0, i) + ch + g.slice(i + 1)), false);
  }), {numRuns: 300});
});

test('GST split: halves add up within a state, IGST across states, exports flagged', () => {
  fc.assert(fc.property(fc.integer({min: 0, max: 50_000_000_00}), cents => {
    const tax = cents / 100;
    const intra = G.gstSplit(tax, '33', '33');
    assert.equal(intra.kind, 'intra'); assert.equal(Math.round((intra.cgst + intra.sgst) * 100), cents); assert.ok(Math.abs(Math.round(intra.cgst * 100) - Math.round(intra.sgst * 100)) <= 1); assert.equal(intra.igst, 0);
    const inter = G.gstSplit(tax, '33', '29');
    assert.deepEqual(inter, {kind: 'inter', cgst: 0, sgst: 0, igst: tax});
    assert.equal(G.gstSplit(tax, '33', G.EXPORT_STATE).kind, 'export');
  }), {numRuns: 500});
});

test('place of supply: GSTIN, then address, then export, then the supplier', () => {
  assert.deepEqual(G.placeOfSupply({client_gstin: '29AAGCB7383J1Z4', client_state: '07', currency: 'INR', seller_state: '33'}), {code: '29', basis: 'gstin'});
  assert.deepEqual(G.placeOfSupply({client_gstin: '', client_state: '07', currency: 'INR', seller_state: '33'}), {code: '07', basis: 'address'});
  assert.deepEqual(G.placeOfSupply({client_state: '96', currency: 'INR', seller_state: '33'}), {code: '96', basis: 'export'});
  assert.deepEqual(G.placeOfSupply({currency: 'USD', seller_state: '33'}), {code: '96', basis: 'export'});
  assert.deepEqual(G.placeOfSupply({currency: 'INR', seller_state: '33'}), {code: '33', basis: 'supplier'});
  assert.equal(G.isGstLabel('GST'), true); assert.equal(G.isGstLabel('IGST 18%'), true); assert.equal(G.isGstLabel('VAT'), false); assert.equal(G.isGstLabel('Gastro tax'), false);
});

test('amounts in words with Indian grouping', () => {
  assert.equal(G.rupeesInWords(0), 'Zero rupees only');
  assert.equal(G.rupeesInWords(1), 'One rupee only');
  assert.equal(G.rupeesInWords(94400), 'Ninety-four thousand four hundred rupees only');
  assert.equal(G.rupeesInWords(125000.5), 'One lakh twenty-five thousand rupees and fifty paise only');
  assert.equal(G.rupeesInWords(23600000), 'Two crore thirty-six lakh rupees only');
  assert.equal(G.rupeesInWords(0.75), 'Seventy-five paise only');
  fc.assert(fc.property(fc.integer({min: 0, max: 99_99_99_999_99}), cents => {
    const w = G.rupeesInWords(cents / 100);
    assert.match(w, /^[A-Z][a-z -]+only$/);
    assert.ok(!/undefined|  /.test(w));
  }), {numRuns: 500});
});

const seller = {name: 'Ada Studio', address: '12 MG Road, Chennai', tax_id: '33ABCDE1234F1Z5', payment_details: 'UPI ada@okbank'};
const base = {number: 'NT-0001', issued: '2026-10-09', due_days: 30, description: '', seller, client: {name: 'Nilgiri Tea', email: ''}, project: {id: 'p1', title: 'Website', version: 1}, currency: 'INR', tax_label: 'GST', tax_pct: 18, agreed_total: 236000, paid: 0, payment_terms: 'Net 30'};
const gst = {seller_state: '33', sac: '998314', lut_arn: 'AD330925000123X', client_gstin: '', client_state: '', client_address: ''};

test('tax invoice content: split matches the tax, words, milestone and FX; plain invoice without GST', () => {
  fc.assert(fc.property(fc.integer({min: 100, max: 236000_00}), fc.constantFrom('33', '29', '96'), (cents, state) => {
    const c = I.invoiceContent({...base, amount: cents / 100, gst: {...gst, client_state: state}});
    assert.ok(c.gst);
    assert.equal(Math.round((c.gst.cgst + c.gst.sgst + c.gst.igst) * 100), Math.round(c.tax.amount * 100));
    assert.equal(c.gst.kind, state === '33' ? 'intra' : state === '96' ? 'export' : 'inter');
    assert.equal(c.gst.lut_arn, ''); // tax was charged, so not under the LUT
    assert.ok(c.gst.total_in_words.endsWith('only'));
  }), {numRuns: 300});
  const exported = I.invoiceContent({...base, tax_pct: 0, tax_label: 'GST', currency: 'USD', amount: 1000, gst});
  assert.deepEqual([exported.gst.kind, exported.gst.igst, exported.gst.lut_arn, exported.gst.total_in_words], ['export', 0, 'AD330925000123X', '']);
  assert.equal(I.invoiceContent({...base, tax_label: 'VAT', amount: 1000, gst}).gst, undefined);
  assert.equal(I.invoiceContent({...base, amount: 1000, gst: {...gst, seller_state: ''}}).gst, undefined);
  const m = I.invoiceContent({...base, amount: 94400, gst, milestone: {id: 'm1', title: 'On signature', pct: 40}, fx: {currency: 'USD', rate: 0.012, as_of: '2026-10-01', source: 'ECB'}});
  assert.equal(m.line.description, 'On signature (40% milestone) for Website, approved scope version 1');
  assert.deepEqual(m.fx, {currency: 'USD', rate: 0.012, as_of: '2026-10-01', source: 'ECB', total: 1132.8});
  const pdf = Buffer.from(I.renderInvoicePdf(m)).toString('latin1').replace(/\\([()])/g, '$1');
  for (const s of ['TAX INVOICE', 'GSTIN: 33ABCDE1234F1Z5', 'Place of supply: Tamil Nadu (33)', 'CGST (9%)', 'SGST (9%)', 'SAC 998314', 'Amount in words', 'In USD at the agreed 0.012', 'Authorised signatory']) assert.ok(pdf.includes(s), s);
  assert.deepEqual(I.renderInvoicePdf(m), I.renderInvoicePdf(m));
});

test('Net-X: days from the payment terms', () => {
  for (const [t, n] of [['Net 30', 30], ['net-15 from invoice', 15], ['Balance within 7 days of delivery', 7], ['NET30', 30], ['Due on receipt', null], ['', null], [undefined, null], ['Net 500', null]]) assert.equal(I.netDays(t), n, String(t));
});

test('payment schedule: milestones add up to the total; scope rules', () => {
  fc.assert(fc.property(fc.array(fc.integer({min: 1, max: 60}), {minLength: 1, maxLength: 8}), fc.integer({min: 0, max: 10_000_000_00}), (weights, cents) => {
    const sum = weights.reduce((a, b) => a + b, 0);
    let left = 100;
    const pcts = weights.map((w, i) => { const p = i === weights.length - 1 ? Math.round(left * 100) / 100 : Math.round(w / sum * 10000) / 100; left -= p; return p; });
    if (pcts.some(p => p <= 0)) return;
    const lines = M.schedule({milestones: pcts.map((pct, i) => ({id: 'm' + i, title: 'M' + i, pct, due: ''}))}, cents / 100);
    assert.equal(Math.round(lines.reduce((a, l) => a + l.amount, 0) * 100), cents);
    for (const l of lines) assert.ok(l.amount >= 0);
  }), {numRuns: 300});
  const s = {title: 'Schedule check', client: 'Acme', deliverables: 'Some work', exclusions: '', fee: 1000, currency: 'INR', revisions: 1, due: '', notes: ''};
  assert.equal(scopeSchema.safeParse({...s, milestones: [{id: 'a', title: 'Half', pct: 50, due: ''}, {id: 'b', title: 'Half', pct: 50, due: ''}]}).success, true);
  assert.match(scopeSchema.safeParse({...s, milestones: [{id: 'a', title: 'Half', pct: 50, due: ''}]}).error.issues[0].message, /add up to 100%/);
  assert.match(scopeSchema.safeParse({...s, deposit_pct: 30, milestones: [{id: 'a', title: 'All', pct: 100, due: ''}]}).error.issues[0].message, /deposit or a payment schedule/);
  assert.equal(scopeSchema.safeParse({...s, milestones: [{id: 'a', title: 'All', pct: 100, due: ''}, {id: 'a', title: 'Dup', pct: 0.5, due: ''}]}).success, false);
  assert.equal(scopeSchema.safeParse({...s, milestones: []}).success, false);
  assert.equal(scopeSchema.safeParse({...s, fx: {currency: 'INR', rate: 1, as_of: '2026-10-01', source: 'x'}}).success, false);
  assert.equal(scopeSchema.safeParse({...s, fx: {currency: 'USD', rate: 0.012, as_of: '', source: 'ECB'}}).success, false);
  assert.equal(M.fxLine({...s, fx: {currency: 'USD', rate: 0.012, as_of: '2026-10-01', source: 'ECB'}}, 1000), '≈ $12.00 at 0.012 USD/INR (ECB, 2026-10-01)');
  assert.equal(M.fxLine(s, 1000), '');
  // Unset terms stay out of the content, so older signed scopes keep their hash.
  assert.deepEqual(Object.keys(scopeSchema.parse(s)).sort(), Object.keys(s).sort());
});

test('invoice status: payments cover invoices in order after what was paid before; reminders', () => {
  const inv = [{seq: 1, total: 100, due: '2026-10-01', paid_before: 30}, {seq: 2, total: 50, due: '2026-10-20', paid_before: 30}];
  assert.deepEqual(S.invoiceStatuses(inv, 30, '2026-10-05').map(s => [s.status, s.overdue, s.days_overdue]), [['open', true, 4], ['open', false, 0]]);
  assert.deepEqual(S.invoiceStatuses(inv, 160, '2026-10-25').map(s => [s.status, s.covered, s.overdue]), [['paid', 100, false], ['part', 30, true]]);
  fc.assert(fc.property(fc.array(fc.integer({min: 1, max: 100000}), {minLength: 1, maxLength: 6}), fc.integer({min: 0, max: 700000}), (totals, paidCents) => {
    const list = totals.map((t, i) => ({seq: i + 1, total: t / 100, due: '2026-10-01', paid_before: 0}));
    const out = S.invoiceStatuses(list, paidCents / 100, '2026-10-02');
    const covered = Math.round(out.reduce((a, s) => a + s.covered, 0) * 100);
    assert.equal(covered, Math.min(paidCents, totals.reduce((a, b) => a + b, 0)));
    // Once one invoice is not fully covered, no later one has anything covered.
    const firstOpen = out.findIndex(s => s.status !== 'paid');
    if (firstOpen >= 0) for (const s of out.slice(firstOpen + 1)) assert.equal(s.covered, 0);
  }), {numRuns: 300});
  const day = 86400_000, now = Date.parse('2026-10-20T03:00:00Z');
  const overdue = {seq: 1, covered: 0, open: 10, status: 'open', overdue: true, days_overdue: 5};
  assert.equal(S.invoiceReminderDue(overdue, [], 5, now), true);
  assert.equal(S.invoiceReminderDue(overdue, [new Date(now - 2 * day).toISOString()], 5, now), false);
  assert.equal(S.invoiceReminderDue(overdue, [new Date(now - 5 * day + 1800_000).toISOString()], 5, now), true); // within the hour of slack
  assert.equal(S.invoiceReminderDue(overdue, ['2026-01-01', '2026-02-01', '2026-03-01'].map(d => d + 'T00:00:00Z'), 5, now), false);
  assert.equal(S.invoiceReminderDue({...overdue, overdue: false}, [], 5, now), false);
});

test('revision bank: rounds draw hours, change orders top up, overage billed at the rate', () => {
  const {baseline} = approvedScope({revision_bank: {unit: 'hours', amount: 10, overage_rate: 2000}});
  const entry = (seq, kind, payload) => ({seq, kind, baseline_version: 1, actor: 'owner', created: '2026-10-07T09:00:00.000Z', payload, prev_hash: '', hash: '', payload_hash: '', signature: null});
  const rounds = [entry(1, 'revision_round', {feedback_date: '2026-10-02', note: '', used: 6}), entry(2, 'revision_round', {feedback_date: '2026-10-03', note: '', used: 7.5})];
  const a = L.computeAgreement(baseline, 1, rounds);
  assert.deepEqual(a.bank, {unit: 'hours', allowed: 10, used: 13.5, left: 0, over: 3.5, overage_rate: 2000, overage_value: 7000});
  assert.match(L.checkEntry('revision_round', {feedback_date: '2026-10-04', note: ''}, baseline, a, 'owner'), /how many hours/);
  assert.equal(L.checkEntry('revision_round', {feedback_date: '2026-10-04', note: '', used: 1}, baseline, a, 'owner'), null);
  const co = {title: 'Top up', reason: '', request_quote: '', add_items: [], remove_item_ids: [], fee_delta: 0, days_delta: 0, revisions_delta: 0, bank_delta: 5};
  assert.equal(L.checkEntry('change_order', co, baseline, a, 'owner'), null);
  assert.match(L.checkEntry('change_order', {...co, bank_delta: -11}, baseline, a, 'owner'), /below zero/);
  const topped = L.computeAgreement(baseline, 1, [...rounds, entry(3, 'change_order', co), entry(4, 'settle', {ref_seq: 3, outcome: 'approved', signer: 'Client', comment: ''})]);
  assert.deepEqual([topped.bank.allowed, topped.bank.left, topped.bank.over], [15, 1.5, 0]);
  assert.equal(L.changeOrderSchema.safeParse({title: 'Only the bank', bank_delta: 2}).success, true);
  // Without a bank, hours are refused and the agreement has none.
  const plain = approvedScope().baseline;
  const p = L.computeAgreement(plain, 1, []);
  assert.equal(p.bank, undefined);
  assert.match(L.checkEntry('revision_round', {feedback_date: '2026-10-04', note: '', used: 1}, plain, p, 'owner'), /no revision bank/);
  assert.match(L.checkEntry('change_order', co, plain, p, 'owner'), /no revision bank/);
  const money = approvedScope({revision_bank: {unit: 'money', amount: 500}});
  const mb = L.computeAgreement(money.baseline, 1, [entry(1, 'revision_round', {feedback_date: '2026-10-02', note: '', used: 650})]);
  assert.deepEqual([mb.bank.over, mb.bank.overage_value], [150, 150]);
});

test('reference rates: parsing, errors, caching and off switch', async () => {
  let calls = 0;
  const fake = body => async url => { calls++; assert.match(String(url), /\?base=USD&symbols=INR$/); return new Response(JSON.stringify(body), {status: 200}); };
  const env = {SCOPEFLOW_FX_URL: 'http://fx.test/latest'};
  assert.deepEqual(await FX.referenceRate('USD', 'INR', {env, fetchImpl: fake({date: '2026-10-01', rates: {INR: 83.123456789}}), now: 1}), {rate: 83.123457, as_of: '2026-10-01', source: 'Reference rate'});
  await FX.referenceRate('USD', 'INR', {env, fetchImpl: fake({}), now: 2});
  assert.equal(calls, 1, 'cached for an hour');
  await assert.rejects(FX.referenceRate('USD', 'INR', {env, fetchImpl: fake({date: '2026-10-01', rates: {}}), now: 4000_000}), /No reference rate/);
  await assert.rejects(FX.referenceRate('USD', 'INR', {env, fetchImpl: async () => { throw new Error('down'); }, now: 9000_000}), e => e.status === 502);
  await assert.rejects(FX.referenceRate('USD', 'USD', {env}), e => e.status === 400);
  await assert.rejects(FX.referenceRate('USD', 'INR', {env: {SCOPEFLOW_FX_URL: 'off'}}), e => e.status === 503);
  assert.equal(FX.fxUrl({}), 'https://api.frankfurter.dev/v1/latest');
});

test('Razorpay order lookup: the captured payment of the order, or null', async () => {
  const config = {keyId: 'rzp_test_x', keySecret: 's'};
  const reply = (items, status = 200) => async (url, init) => {
    assert.equal(String(url), 'http://rzp.test/v1/orders/order_1/payments');
    assert.equal(init.headers.Authorization, 'Basic ' + Buffer.from('rzp_test_x:s').toString('base64'));
    return new Response(JSON.stringify(status === 200 ? {items} : {error: {description: 'Bad key'}}), {status});
  };
  const env = {RAZORPAY_API_URL: 'http://rzp.test/'};
  assert.deepEqual(await R.capturedPayment(config, 'order_1', reply([{id: 'pay_f', status: 'failed', order_id: 'order_1', amount: 100, currency: 'INR'}, {id: 'pay_c', status: 'captured', order_id: 'order_1', amount: 500000, currency: 'INR'}]), env),
    {event_id: null, order_id: 'order_1', payment_id: 'pay_c', amount_minor: 500000, currency: 'INR'});
  assert.equal(await R.capturedPayment(config, 'order_1', reply([{id: 'pay_a', status: 'authorized', order_id: 'order_1', amount: 1, currency: 'INR'}]), env), null);
  await assert.rejects(R.capturedPayment(config, 'order_1', reply([], 401), env), /Bad key/);
  assert.equal(R.razorpayApi({}), 'https://api.razorpay.com');
});
