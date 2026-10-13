// WS-04 differential test (C4): for ledgers WITHOUT a supersede (one baseline), the project-wide
// moneyState() must equal the Phase 0 per-baseline fold it replaced (vendored in
// tests/fixtures/ws-04-pre/money-ledger.ts), field for field. Only ledgers that span several
// baselines may differ, and there the new fold counts what the old one dropped (tested in
// tests/property/ws-04-payments.test.mjs).
// @covers C4
import '../support/fc-setup.mjs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fc, tick} from '../support/property.mjs';
import {approve, append} from '../support/chain.mjs';

const now = await import('../../lib/money-ledger.ts');
const old = await import('../fixtures/ws-04-pre/money-ledger.ts');

const content = currency => ({title: 'Differential fixture', client: 'Acme', deliverables: 'Logo design', exclusions: '', fee: 10000, currency, revisions: 2, due: '', notes: ''});
const op = fc.record({kind: fc.constantFrom('payment', 'payment_received', 'refund'), units: fc.integer({min: 1, max: 9_000_000}), purpose: fc.constantFrom('deposit', 'invoice'), hidden: fc.boolean()});

test('single-baseline ledgers: new moneyState == old per-baseline fold', async () => {
  // @covers C4
  await fc.assert(fc.asyncProperty(fc.constantFrom('INR', 'USD', 'EUR', 'JPY'), fc.array(op, {maxLength: 15}), fc.integer({min: 0, max: 20_000_000}), fc.integer({min: 0, max: 5_000_000}), fc.integer({min: 1, max: 3}),
    async (currency, ops, total, deposit, version) => {
      const exp = currency === 'JPY' ? 0 : 2;
      const b = await approve(content(currency), {version});
      const entries = [];
      for (const [i, o] of ops.entries()) {
        const amount = o.units / 10 ** exp;
        const payload = o.kind === 'payment' ? {provider: 'razorpay', purpose: o.purpose, order_id: 'order_' + i, payment_id: 'pay_' + i, amount, currency}
          : o.kind === 'payment_received' ? {amount, method: 'upi', received: '2026-10-01', reference: '', note: ''}
          : {amount, method: 'bank_transfer', refunded: '2026-10-02', reference: '', note: ''};
        const e = await append(entries, b, o.kind, payload, o.kind === 'payment' ? 'system' : 'owner', tick(i + 1));
        entries.push(e);
      }
      const agreement = {baseline_version: version, currency, total, deposit};
      assert.deepEqual(now.moneyState(entries, agreement), old.moneyState(entries, agreement));
      // The client's view (hidden payloads are never money entries, but nulls must fold the same).
      const masked = entries.map((e, i) => ops[i].hidden && ops[i].kind === 'refund' ? {...e, payload: null} : e);
      assert.deepEqual(now.moneyState(masked, agreement), old.moneyState(masked, agreement));
    }), {numRuns: 150});
});
