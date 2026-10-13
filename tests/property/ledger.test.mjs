// Invariants of the agreement ledger: append-only, tamper-evident, and the fee rule.
import '../support/fc-setup.mjs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fc, scopeArb, freezeClock, tick} from '../support/property.mjs';
import {approve, append, buildLedger, opArb, computeAgreement, verifyChain, entryHash, sha256, serverVerdict, GENESIS} from '../support/chain.mjs';

freezeClock();
const {scopeSchema} = await import('../../lib/scope.ts');
const baselineArb = scopeArb.filter(s => scopeSchema.safeParse(s).success).map(s => scopeSchema.parse(s));
const ledgerArb = fc.tuple(baselineArb, fc.array(opArb, {minLength: 1, maxLength: 14}));
const round2 = x => Math.round(x * 100) / 100;

async function generated([content, ops]) {
  const baseline = await approve(content);
  return {baseline, entries: await buildLedger(baseline, ops)};
}

test('a generated ledger verifies, server-side and from the client view', async () => {
  await fc.assert(fc.asyncProperty(ledgerArb, async input => {
    const {baseline, entries} = await generated(input);
    const v = await serverVerdict(baseline, entries);
    assert.equal(v.chain.intact, true);
    assert.equal(v.seal, 'valid');
    const client = await verifyChain(entries.map(e => (e.kind === 'goodwill' && e.payload.visible === false ? {...e, payload: null} : e)), {1: v.anchor});
    assert.equal(client.intact, true);
    assert.equal(client.head, v.chain.head);
  }), {numRuns: 60});
});

test('append-only: appending never changes an earlier entry or hash', async () => {
  await fc.assert(fc.asyncProperty(ledgerArb, fc.array(opArb, {minLength: 1, maxLength: 4}), async ([content, ops], more) => {
    const baseline = await approve(content);
    const before = await buildLedger(baseline, ops);
    const after = await buildLedger(baseline, [...ops, ...more]);
    assert.deepEqual(after.slice(0, before.length), before);
    // Every head the client ever saw stays on the chain at the same position.
    for (const e of before) assert.equal(after[e.seq - 1].hash, e.hash);
  }), {numRuns: 50});
});

// Ways someone with database access could rewrite history.
const tampers = {
  'edit a visible payload': (es, i) => es[i].payload ? es.map((e, n) => (n === i ? {...e, payload: {...e.payload, title: (e.payload.title ?? '') + 'x', ref_seq: e.payload.ref_seq}} : e)) : null,
  'edit the stored payload and its hash': (es, i) => es.map((e, n) => (n === i ? {...e, payload_hash: e.payload_hash.replace(/^./, c => (c === '0' ? '1' : '0'))} : e)),
  'change created': (es, i) => es.map((e, n) => (n === i ? {...e, created: tick(99999)} : e)),
  'change actor': (es, i) => es.map((e, n) => (n === i ? {...e, actor: e.actor === 'owner' ? 'client' : 'owner'} : e)),
  'change kind': (es, i) => es.map((e, n) => (n === i ? {...e, kind: e.kind === 'goodwill' ? 'revision_round' : 'goodwill'} : e)),
  'change baseline version': (es, i) => es.map((e, n) => (n === i ? {...e, baseline_version: 2} : e)),
  'drop an entry in the middle': (es, i) => (i < es.length - 1 ? es.filter((_, n) => n !== i) : null),
  'swap two entries': (es, i) => (es.length > 1 ? es.map((e, n) => (n === i ? es[(i + 1) % es.length] : n === (i + 1) % es.length ? es[i] : e)) : null),
  'duplicate an entry': (es, i) => [...es.slice(0, i + 1), es[i], ...es.slice(i + 1)],
};

test('tamper-evident: any rewrite breaks the chain', async () => {
  const names = Object.keys(tampers);
  await fc.assert(fc.asyncProperty(ledgerArb, fc.nat(), fc.integer({min: 0, max: names.length - 1}), async (input, pick, t) => {
    const {baseline, entries} = await generated(input);
    fc.pre(entries.length > 0);
    const mutated = tampers[names[t]](entries, pick % entries.length);
    fc.pre(mutated !== null);
    const v = await serverVerdict(baseline, mutated);
    assert.equal(v.chain.intact, false, names[t]);
  }), {numRuns: 150});
});

test('tamper-evident: rewriting the approved scope breaks every entry anchored to it', async () => {
  await fc.assert(fc.asyncProperty(ledgerArb, async input => {
    const {baseline, entries} = await generated(input);
    fc.pre(entries.length > 0);
    const rewritten = {...baseline, content: {...baseline.content, fee: baseline.content.fee + 1}};
    assert.equal((await serverVerdict(rewritten, entries)).chain.intact, false);
  }), {numRuns: 50});
});

test('tamper-evident: a consistent rewrite (all hashes recomputed) is caught by the signatures', async () => {
  await fc.assert(fc.asyncProperty(ledgerArb, fc.nat(), async (input, pick) => {
    const {baseline, entries} = await generated(input);
    fc.pre(entries.length > 0);
    const i = pick % entries.length;
    // Rewrite entry i's payload and re-link everything after it, without the signing key.
    const forged = [];
    for (const [n, e] of entries.entries()) {
      const payload = n === i && e.payload ? {...e.payload, note: 'rewritten'} : e.payload;
      const payload_hash = payload ? await sha256(JSON.stringify(payload)) : e.payload_hash;
      const base = {...e, payload_hash, prev_hash: forged.at(-1)?.hash ?? GENESIS};
      forged.push({...base, payload, hash: await entryHash(base, baseline.anchor), signature: e.signature});
    }
    const v = await serverVerdict(baseline, forged);
    assert.equal(v.chain.intact, true);
    assert.equal(v.seal, 'invalid');
  }), {numRuns: 50});
});

test('truncating the tail is detectable against any head the client already holds', async () => {
  await fc.assert(fc.asyncProperty(ledgerArb, fc.nat(), async (input, cut) => {
    const {baseline, entries} = await generated(input);
    fc.pre(entries.length > 1);
    const keep = cut % entries.length;
    const truncated = entries.slice(0, keep);
    const v = await serverVerdict(baseline, truncated);
    // The shorter chain is internally consistent, so a receipt is the witness: the latest
    // hash the client was given (CO receipts carry it) is no longer on the chain.
    assert.equal(v.chain.intact, true);
    assert.notEqual(v.chain.head, entries.at(-1).hash);
    assert.ok(!truncated.some(e => e.hash === entries.at(-1).hash));
  }), {numRuns: 50});
});

test('fee = baseline fee + approved change orders only', async () => {
  await fc.assert(fc.asyncProperty(ledgerArb, async input => {
    const {baseline, entries} = await generated(input);
    const a = computeAgreement(baseline.content, 1, entries);
    const settled = new Map(entries.filter(e => e.kind === 'settle').map(e => [e.payload.ref_seq, e.payload.outcome]));
    let expected = baseline.content.fee;
    for (const e of entries) if (e.kind === 'change_order' && settled.get(e.seq) === 'approved') expected += e.payload.fee_delta;
    assert.equal(a.fee, round2(expected));
    assert.equal(a.fee_base, baseline.content.fee);
    assert.ok(a.fee >= 0);
    // Goodwill, revision rounds and declined/withdrawn/pending change orders never move it.
    const onlyApproved = entries.filter(e => e.kind === 'change_order' ? settled.get(e.seq) === 'approved' : e.kind === 'settle' && e.payload.outcome === 'approved');
    assert.equal(computeAgreement(baseline.content, 1, onlyApproved).fee, a.fee);
  }), {numRuns: 100});
});

test('a pending change order never changes the fee, items, rounds or due date', async () => {
  await fc.assert(fc.asyncProperty(ledgerArb, fc.integer({min: -500000, max: 500000}), fc.integer({min: 0, max: 3}), async (input, cents, rounds) => {
    const {baseline, entries} = await generated(input);
    const before = computeAgreement(baseline.content, 1, entries);
    const co = {title: 'Pending change', reason: '', request_quote: '', add_items: [{id: 'pending_item', title: 'Pending item', qty: 1, unit: '', price: null, acceptance: ''}], remove_item_ids: [], fee_delta: cents / 100, days_delta: 0, revisions_delta: rounds};
    fc.pre(before.fee + co.fee_delta >= 0 && !before.items.some(i => i.id === 'pending_item'));
    const after = computeAgreement(baseline.content, 1, [...entries, await append(entries, baseline, 'change_order', co, 'owner', tick(500))]);
    assert.equal(after.fee, before.fee);
    assert.deepEqual(after.items, before.items);
    assert.equal(after.revisions_allowed, before.revisions_allowed);
    assert.equal(after.due, before.due);
    assert.equal(after.pending, before.pending + 1);
  }), {numRuns: 100});
});
