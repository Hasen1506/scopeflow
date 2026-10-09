// Invoices, business profile and automatic reminders (pure): the tax split always adds up, numbers
// are padded and prefixed, the amount is capped by the balance, the PDF is deterministic, profile
// validation and draft defaults, and the automatic-reminder rule.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fc} from '../support/property.mjs';

const I = await import('../../lib/invoice.ts');
const P = await import('../../lib/profile.ts');
const M = await import('../../lib/mail.ts');
const seller = {name: 'Ada Studio', address: '12 MG Road, Chennai', tax_id: '33ABCDE1234F1Z5', payment_details: 'UPI ada@okbank'};
const base = {number: 'INV-0001', issued: '2026-10-09', due_days: 15, description: '', seller, client: {name: 'Kaveri Foods', email: 'ops@kaveri.test'}, project: {id: 'p1', title: 'Packaging', version: 1}, currency: 'INR', tax_label: 'GST', tax_pct: 18, agreed_total: 141600, paid: 42480, payment_terms: 'Net 15'};

test('tax split: subtotal + tax = total for any amount and rate', () => {
  fc.assert(fc.property(fc.integer({min: 1, max: 10_000_000_00}), fc.constantFrom(0, 5, 12, 18, 28, 7.5), (cents, pct) => {
    const c = I.invoiceContent({...base, amount: cents / 100, tax_pct: pct});
    assert.equal(c.total, cents / 100);
    if (pct === 0) { assert.equal(c.tax, null); assert.equal(c.line.amount, c.total); return; }
    assert.equal(Math.round((c.tax.taxable + c.tax.amount) * 100), cents);
    assert.ok(Math.abs(c.tax.amount - c.tax.taxable * pct / 100) <= 0.01 + 1e-9);
  }), {numRuns: 500});
});

test('content: dates, balance before and after, default description', () => {
  const c = I.invoiceContent({...base, amount: 99120});
  assert.equal(c.due, '2026-10-24');
  assert.deepEqual(c.agreement, {total: 141600, paid_before: 42480, balance_before: 99120, balance_after: 0});
  assert.match(c.line.description, /^Balance for Packaging \(approved scope, version 1\)$/);
  assert.match(I.invoiceContent({...base, amount: 10000}).line.description, /^Part payment for/);
  assert.equal(I.invoiceContent({...base, amount: 10, description: 'Milestone 2'}).line.description, 'Milestone 2');
  assert.equal(I.invoiceNumber('', 7), 'INV-0007');
  assert.equal(I.invoiceNumber('AS/26-', 12345), 'AS/26-12345');
});

test('amount checks: two decimals, never more than the balance, nothing when paid in full', () => {
  assert.equal(I.invoiceProblem(100, 100, 'INR'), null);
  assert.equal(I.invoiceProblem(0.29, 100, 'INR'), null);
  assert.match(I.invoiceProblem(100.01, 100, 'INR'), /more than the/);
  assert.match(I.invoiceProblem(1.005, 100, 'INR'), /two decimals/);
  assert.match(I.invoiceProblem(1, 0, 'INR'), /paid in full/);
  assert.equal(I.invoiceRequestSchema.safeParse({amount: 5, extra: 1}).success, false);
  assert.deepEqual(I.invoiceRequestSchema.parse({amount: 5}), {amount: 5, description: '', due_days: 15});
});

test('PDF: deterministic, prints seller, client, number, tax split and how to pay', () => {
  const c = I.invoiceContent({...base, amount: 99120});
  const a = I.renderInvoicePdf(c), b = I.renderInvoicePdf(c);
  assert.deepEqual(a, b);
  const text = Buffer.from(a).toString('latin1').replace(/\\([()])/g, '$1');
  for (const s of ['INVOICE', 'Balance for Packaging (approved scope, version 1)', 'INV-0001', 'Ada Studio', 'Tax ID: 33ABCDE1234F1Z5', 'BILL TO', 'Kaveri Foods', 'Subtotal', 'GST (18%)', 'Total due', 'Rs.99,120.00', 'UPI ada@okbank', 'Net 15', '24 Oct 2026']) assert.ok(text.includes(s), s);
});

test('profile: validation and the defaults a new draft starts with', () => {
  const ok = {...P.defaultProfile, business_name: 'Ada Studio', invoice_prefix: 'AS/26-', default_currency: 'INR', default_tax_label: 'GST', default_tax_pct: 18, default_deposit_pct: 30, default_payment_terms: 'Net 15', auto_remind_days: 5};
  assert.deepEqual(P.profileSchema.parse(ok), ok);
  for (const bad of [{invoice_prefix: 'INV 1'}, {default_currency: 'XXX'}, {default_tax_pct: 101}, {auto_remind_days: 4}, {extra: 1}]) assert.equal(P.profileSchema.safeParse({...ok, ...bad}).success, false, JSON.stringify(bad));
  assert.deepEqual(P.draftDefaults(ok), {currency: 'INR', tax_pct: 18, tax_label: 'GST', deposit_pct: 30, payment_terms: 'Net 15'});
  assert.deepEqual(P.draftDefaults(P.defaultProfile), {});
  assert.deepEqual(P.profileFromRow(null), P.defaultProfile);
});

test('automatic reminders: only when turned on, after the chosen wait, within the manual limits', () => {
  const now = Date.parse('2026-10-09T12:00:00Z'), daysAgo = d => new Date(now - d * 86400_000).toISOString();
  const due = (o) => M.autoReminderDue({last_sent: null, sent_version: null, reminders: 0, version: 1, created: daysAgo(6), auto_days: 5, ...o}, now);
  assert.equal(due({}), true);
  assert.equal(due({auto_days: null}), false);
  assert.equal(due({auto_days: 7}), false);
  assert.equal(due({last_sent: daysAgo(2), sent_version: 1}), false); // emailed 2 days ago: wait from then
  assert.equal(due({last_sent: daysAgo(5.5), sent_version: 1, reminders: 1}), true);
  assert.equal(due({last_sent: daysAgo(9), sent_version: 1, reminders: 3}), false); // cap reached
  assert.equal(due({last_sent: daysAgo(1), sent_version: 0}), true); // emailed about an older version
});
