// WS-05 differential: for ledgers made only of the kinds that existed before WS-05, the new lib/ledger.ts
// agrees with main at 5e59e44 (vendored in tests/fixtures/ws-05-pre/ledger.ts): the hash-chain
// format (anchor and entry hashes, chain verification), every payload schema, checkEntry without a
// date context, and the agreement fold. The only allowed difference is the added
// `agreement.deliverables` view (LT-14), which is checked against its definition.
import '../support/fc-setup.mjs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fc, scopeArb, freezeClock, tick} from '../support/property.mjs';
import {approve, buildLedger, opArb} from '../support/chain.mjs';

freezeClock();
const {scopeSchema, itemLine} = await import('../../lib/scope.ts');
const now = await import('../../lib/ledger.ts');
const old = await import('../fixtures/ws-05-pre/ledger.ts');
const baselineArb = scopeArb.filter(s => scopeSchema.safeParse(s).success).map(s => scopeSchema.parse(s));

// @covers H6 H17 LT-08
test('hash chain format is unchanged for existing kinds (anchor, entry hash, verifyChain)', async () => {
  await fc.assert(fc.asyncProperty(baselineArb, fc.array(opArb, {minLength: 1, maxLength: 12}), fc.nat(), async (content, ops, pick) => {
    const b = await approve(content);
    const entries = await buildLedger(b, ops);
    assert.equal(await now.anchorHash(b), await old.anchorHash(b));
    for (const e of entries) assert.equal(await now.entryHash(e, b.anchor), await old.entryHash(e, b.anchor));
    const tampered = entries.length ? entries.map((e, n) => (n === pick % entries.length ? {...e, created: tick(424242)} : e)) : entries;
    for (const list of [entries, tampered]) assert.deepEqual(await now.verifyChain(list, {1: b.anchor}), await old.verifyChain(list, {1: b.anchor}));
  }), {numRuns: 120});
});

test('the agreement fold and checkEntry agree with 5e59e44 on pre-WS-05 ledgers (plus the deliverables view)', async () => {
  await fc.assert(fc.asyncProperty(baselineArb, fc.array(opArb, {minLength: 0, maxLength: 12}), async (content, ops) => {
    const b = await approve(content);
    const entries = await buildLedger(b, ops);
    const a = now.computeAgreement(content, 1, entries), o = old.computeAgreement(content, 1, entries);
    const {deliverables, ...rest} = a;
    assert.deepEqual(rest, o);
    assert.equal(deliverables, a.items.map(i => itemLine(i) + (i.source === 'baseline' ? '' : ` [CO-${i.source}]`)).join('\n'));
    assert.equal('retainer' in a, false);
    // Validation of the next entry (no date context, as before) is identical.
    const probe = [
      ['goodwill', {title: 'Extra', value: 10, hours: 0, note: '', visible: true}, 'owner'],
      ['revision_round', {feedback_date: '2030-01-01', note: ''}, 'owner'],
      ['change_order', {title: 'Probe', reason: '', request_quote: '', add_items: [], remove_item_ids: a.items.slice(0, 1).map(i => i.id), fee_delta: -1e7, days_delta: 3, revisions_delta: 0}, 'owner'],
      ...a.change_orders.map(c => ['settle', {ref_seq: c.seq, outcome: 'approved', signer: 'Client Signer', comment: ''}, 'client']),
      ...a.change_orders.map(c => ['settle', {ref_seq: c.seq, outcome: 'withdrawn', signer: '', comment: ''}, 'owner']),
    ];
    for (const [kind, payload, actor] of probe) assert.equal(now.checkEntry(kind, payload, content, a, actor), old.checkEntry(kind, payload, content, o, actor), kind);
  }), {numRuns: 120});
});

test('payload schemas accept and normalise pre-WS-05 payloads exactly as before', () => {
  for (const kind of old.entryKinds) {
    const samples = {
      change_order: {title: 'Extra page', add_items: [{id: 'p2', title: 'Second page'}], fee_delta: 100},
      settle: {ref_seq: 1, outcome: 'declined', comment: 'No'},
      goodwill: {title: 'Favicon', value: 0},
      revision_round: {feedback_date: '2026-10-01'},
      client_input: {input_id: 'brief', received: '2026-10-02'},
      payment: {provider: 'stripe', purpose: 'invoice', order_id: 'cs_1', payment_id: 'pi_1', amount: 12.5, currency: 'EUR', invoice_number: 'INV-1'},
      payment_received: {amount: 10, method: 'upi', received: '2026-10-01'},
      refund: {amount: 5, method: 'razorpay', refunded: '2026-10-03', provider_refund_id: 'rfnd_1', refund_of: 4},
    }[kind];
    assert.deepEqual(now.payloadSchemas[kind].parse(samples), old.payloadSchemas[kind].parse(samples), kind);
    assert.equal(now.payloadSchemas[kind].safeParse({...samples, unexpected: 1}).success, false, kind);
  }
});
