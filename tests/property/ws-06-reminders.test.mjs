// WS-06: reminder rules (scripts/send-reminders.mjs). Pure: TDS is never chased as unpaid money,
// and a TDS-certificate reminder goes out at most once a quarter once the certificate is due.
import '../support/fc-setup.mjs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fc, freezeClock} from '../support/property.mjs';

freezeClock();
const R = await import('../../lib/reminder-rules.ts');

test('reminders: an invoice paid net of TDS is not chased; a part-paid one asks only for the cash part', () => {
  assert.equal(R.tdsExpected({tds: {amount: 2000}}), 2000);
  assert.equal(R.tdsExpected({tds: {rate_pct: 10, base: 'taxable_value'}, tax: {taxable: 100000}}), 10000);
  assert.equal(R.tdsExpected({}), 0);
  assert.deepEqual(R.invoicePlan({open: 10000, tds: 10000}), {kind: 'tds_certificate', tds: 10000});
  assert.deepEqual(R.invoicePlan({open: 10000, tds: 10000, status: 'paid_net_of_tds'}), {kind: 'tds_certificate', tds: 10000});
  assert.deepEqual(R.invoicePlan({open: 10000, tds: 10000, credited: 10000}), {kind: 'payment', chase: 10000}, 'credited TDS is ordinary open money again');
  assert.deepEqual(R.invoicePlan({open: 0, tds: 10000, credited: 10000}), {kind: 'none'});
  assert.deepEqual(R.invoicePlan({open: 60000, tds: 10000}), {kind: 'payment', chase: 50000});
  assert.deepEqual(R.invoicePlan({open: 60000, tds: 0}), {kind: 'payment', chase: 60000});
  assert.deepEqual(R.invoicePlan({open: 5, tds: 0, status: 'tds_credited'}), {kind: 'none'});
  fc.assert(fc.property(fc.integer({min: 0, max: 1e7}), fc.integer({min: 0, max: 1e6}), fc.integer({min: 0, max: 1e6}), (o, t, c) => {
    const open = o / 100, tds = t / 100, credited = Math.min(c, t) / 100;
    const p = R.invoicePlan({open, tds, credited});
    if (p.kind === 'payment') { assert.ok(p.chase > 0); assert.ok(p.chase <= open - (tds - credited) + 0.01, 'never asks for the uncredited TDS'); }
  }));
});

test('reminders: TDS certificate reminders are quarterly, after Form 16A is due, at most four', () => {
  assert.deepEqual(R.tdsQuarterOf('2026-05-10'), {key: '2026-27-Q1', label: 'Q1 FY 2026-27', certificateDue: '2026-08-15'});
  assert.equal(R.tdsQuarterOf('2026-10-12').certificateDue, '2027-02-15');
  assert.equal(R.tdsQuarterOf('2027-02-01').key, '2026-27-Q4');
  assert.equal(R.tdsQuarterOf('2027-02-01').certificateDue, '2027-06-15');
  assert.equal(R.tdsCertificateReminderKey('2026-05-10', '2026-08-14', []), null, 'not before the certificate is due');
  assert.equal(R.tdsCertificateReminderKey('2026-05-10', '2026-08-15', []), '2026-27-Q2');
  assert.equal(R.tdsCertificateReminderKey('2026-05-10', '2026-09-30', ['2026-27-Q2']), null, 'once a quarter');
  assert.equal(R.tdsCertificateReminderKey('2026-05-10', '2026-10-01', ['2026-27-Q2']), '2026-27-Q3');
  assert.equal(R.tdsCertificateReminderKey('2026-05-10', '2028-01-01', ['a', 'b', 'c', 'd']), null, 'at most four');
  assert.equal(R.tdsCertificateReminderKey('', '2026-10-01', []), null);
});
