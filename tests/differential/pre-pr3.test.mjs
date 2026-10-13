// Differential tests.
//  A. Canonicaliser and receipt/ledger verification at main vs pre-PR-3 (bda2652, the
//     parent of e19fa63), vendored in tests/fixtures/pre-pr3, on random scopes and ledgers.
//  B. The client's "Verified in your browser" check (lib/record-check.ts, the code the
//     review page runs) vs the server's verification, on random and tampered records.
// Every difference found is asserted to belong to a documented class (docs/testing.md).
import '../support/fc-setup.mjs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fc, scopeArb, idArb, freezeClock, tick} from '../support/property.mjs';
import {approve, append, buildLedger, opArb, serverVerdict, entryHash, sha256, forClient, GENESIS} from '../support/chain.mjs';

freezeClock();
const {scopeSchema} = await import('../../lib/scope.ts');
const now = await import('../../lib/ledger.ts');
const old = await import('../fixtures/pre-pr3/ledger.ts');
const {checkClientRecord} = await import('../../lib/record-check.ts');
const {checkClientRecordPrePr3} = await import('../fixtures/pre-pr3/record-check.ts');
const baselineArb = scopeArb.filter(s => scopeSchema.safeParse(s).success).map(s => scopeSchema.parse(s));

// --------------------------------------------------------------------------- A

test('A1: scope canonicalisation and the anchor hash are identical before and after PR #3', async () => {
  await fc.assert(fc.asyncProperty(scopeArb, idArb, fc.option(fc.string({maxLength: 20}), {nil: null}), fc.nat(1000), async (s, pid, signer, v) => {
    const a = scopeSchema.safeParse(s), b = (await import('../fixtures/pre-pr3/scope.ts')).scopeSchema.safeParse(s);
    assert.equal(a.success, b.success);
    if (!a.success) return;
    assert.equal(JSON.stringify(a.data), JSON.stringify(b.data));
    const anchor = {project_id: pid, version: v, content: a.data, signer, decided: signer ? tick(v) : null};
    assert.equal(await now.anchorHash(anchor), await old.anchorHash(anchor));
  }), {numRuns: 150});
});

test('A2: entry hashes and chain verification agree on random (and tampered) ledgers', async () => {
  await fc.assert(fc.asyncProperty(baselineArb, fc.array(opArb, {minLength: 1, maxLength: 10}), fc.nat(), async (content, ops, pick) => {
    const b = await approve(content);
    const entries = await buildLedger(b, ops);
    fc.pre(entries.length > 0);
    for (const e of entries) assert.equal(await old.entryHash(e, b.anchor), e.hash);
    const i = pick % entries.length;
    for (const list of [entries, entries.map((e, n) => (n === i ? {...e, created: tick(77777)} : e)), entries.filter((_, n) => n !== i)]) {
      assert.deepEqual(await old.verifyChain(list, {1: b.anchor}), await now.verifyChain(list, {1: b.anchor}));
    }
  }), {numRuns: 80});
});

// Ledgers with timeline changes and late client inputs, the area PR #3 changed (SF-12).
const timelineOps = fc.array(fc.oneof(
  fc.record({op: fc.constant('co_days'), days: fc.integer({min: -30, max: 30}).filter(Boolean), approve: fc.boolean()}),
  fc.record({op: fc.constant('input'), late: fc.integer({min: -5, max: 20}), shift: fc.boolean()}),
), {minLength: 1, maxLength: 6});

test('A3: agreement folding differs only for undated scopes with a timeline shift (SF-12)', async () => {
  const seen = {same: 0, differs: 0};
  await fc.assert(fc.asyncProperty(baselineArb, fc.boolean(), timelineOps, async (content, dated, ops) => {
    const base = {...content, due: dated ? '2027-03-01' : '', client_inputs: [{id: 'in1', title: 'Final copy', due: '2027-02-01'}]};
    const b = await approve(base);
    const entries = [];
    for (const o of ops) {
      if (o.op === 'co_days') {
        entries.push(await append(entries, b, 'change_order', {title: 'Timeline change', reason: '', request_quote: '', add_items: [], remove_item_ids: [], fee_delta: 0, days_delta: o.days, revisions_delta: 0}, 'owner', tick(entries.length + 1)));
        if (o.approve) entries.push(await append(entries, b, 'settle', {ref_seq: entries.at(-1).seq, outcome: 'approved', signer: 'Client', comment: ''}, 'client', tick(entries.length + 1)));
      } else if (!entries.some(e => e.kind === 'client_input')) {
        const received = new Date(Date.parse('2027-02-01') + o.late * 86400000).toISOString().slice(0, 10);
        entries.push(await append(entries, b, 'client_input', {input_id: 'in1', received, shift: o.shift, note: ''}, 'owner', tick(entries.length + 1)));
      }
    }
    const a = now.computeAgreement(base, 1, entries), p = old.computeAgreement(base, 1, entries);
    // changed by WS-05: agreement.deliverables (LT-14) is a new derived view the old code never had.
    const keys = Object.keys(a).filter(k => k !== 'deliverables' && JSON.stringify(a[k]) !== JSON.stringify(p[k]));
    if (!keys.length) { seen.same++; return; }
    seen.differs++;
    // Documented class: no baseline due date, yet the old code reported a shift / moved date.
    assert.equal(base.due, '', 'differences only when the scope has no delivery date');
    assert.ok(keys.every(k => ['days_shift', 'delays'].includes(k)), 'unexpected field differs: ' + keys.join(','));
    assert.equal(a.days_shift, 0);
    assert.ok(p.days_shift !== 0 || p.delays.some(d => d.shifted), 'the old code reported a shift');
    assert.ok(a.delays.every(d => !d.shifted));
    assert.equal(a.due, '');
    assert.equal(a.fee, p.fee);
  }), {numRuns: 150});
  assert.ok(seen.differs > 0 && seen.same > 0, JSON.stringify(seen));
});

test('A4: change-order validation now rejects timeline changes on undated scopes; otherwise identical', async () => {
  await fc.assert(fc.asyncProperty(baselineArb, fc.boolean(), fc.integer({min: -30, max: 30}), moneyDelta(), async (content, dated, days, fee) => {
    const base = {...content, due: dated ? '2027-03-01' : ''};
    const co = {title: 'Change', reason: '', request_quote: '', add_items: [], remove_item_ids: [], fee_delta: fee, days_delta: days, revisions_delta: 0};
    const ag = now.computeAgreement(base, 1, []);
    const n = now.checkEntry('change_order', co, base, ag, 'owner'), o = old.checkEntry('change_order', co, base, old.computeAgreement(base, 1, []), 'owner');
    if (!dated && days) assert.match(n ?? '', /no delivery date/); else assert.equal(n, o);
  }), {numRuns: 150});
});

test('A5: receipts: pre-PR-3 accepted a consistent rewrite that the signed record now rejects', async () => {
  await fc.assert(fc.asyncProperty(baselineArb, fc.array(opArb, {minLength: 1, maxLength: 8}), async (content, ops) => {
    const b = await approve(content);
    const entries = await buildLedger(b, ops);
    fc.pre(entries.length > 0);
    // Attacker with database access raises the fee and recomputes every hash; no signing key.
    const forgedContent = {...content, fee: content.fee + 1000};
    const forgedAnchor = await now.anchorHash({...b, content: forgedContent});
    const forged = [];
    for (const e of entries) {
      const base = {...e, prev_hash: forged.at(-1)?.hash ?? GENESIS};
      forged.push({...base, hash: await entryHash(base, forgedAnchor)});
    }
    const scope = {project_id: b.project_id, version: 1, content: forgedContent, signer: b.signer, decided: b.decided};
    const server = await serverVerdict({...b, content: forgedContent}, forged);
    const ledger = {entries: forged.map(forClient), anchors: {1: forgedAnchor}, head: forged.at(-1).hash};
    assert.equal((await checkClientRecordPrePr3(scope, ledger)).state, 'ok', 'pre-PR-3 had no signatures, so it could not tell');
    assert.equal(server.chain.intact, true);
    assert.equal(server.seal, 'invalid');
    assert.equal((await checkClientRecord(scope, {...ledger, seal: {state: server.seal}})).state, 'failed');
  }), {numRuns: 40});
});

// --------------------------------------------------------------------------- B

const clientTampers = ['none', 'content', 'signer', 'payload', 'created', 'drop_middle', 'drop_tail', 'stated_head', 'rehash_all', 'strip_signatures', 'hidden_goodwill_payload'];

/** What GET /api/review/:token returns after a given database tampering, and the server's own verdict. */
async function scenario(b, entries, kind, i) {
  let content = b.content, signer = b.signer, rows = entries.map(e => ({...e}));
  let anchorSig = b.signature;
  if (kind === 'content') content = {...content, title: content.title + ' (edited)'};
  if (kind === 'signer') signer = signer + ' Jr';
  if (kind === 'payload' && rows[i].payload) rows[i] = {...rows[i], payload: {...rows[i].payload, note: 'edited'}, payload_hash: await sha256(JSON.stringify({...rows[i].payload, note: 'edited'}))};
  if (kind === 'created') rows[i] = {...rows[i], created: tick(88888)};
  if (kind === 'drop_middle' && rows.length > 1 && i < rows.length - 1) rows = rows.filter((_, n) => n !== i);
  if (kind === 'drop_tail') rows = rows.slice(0, -1);
  if (kind === 'hidden_goodwill_payload') {
    const g = rows.findIndex(e => e.kind === 'goodwill' && e.payload.visible === false);
    if (g >= 0) rows[g] = {...rows[g], payload: {...rows[g].payload, value: rows[g].payload.value + 1}, payload_hash: await sha256(JSON.stringify({...rows[g].payload, value: rows[g].payload.value + 1}))};
  }
  const anchor = await now.anchorHash({...b, content, signer});
  if (kind === 'rehash_all' || kind === 'strip_signatures') {
    const out = [];
    for (const e of rows) { const base = {...e, prev_hash: out.at(-1)?.hash ?? GENESIS}; out.push({...base, hash: await entryHash(base, anchor), signature: kind === 'strip_signatures' ? null : e.signature}); }
    rows = out;
    if (kind === 'strip_signatures') anchorSig = null;
  }
  const server = await serverVerdict({...b, content, signer, signature: anchorSig}, rows);
  const scope = {project_id: b.project_id, version: 1, content, signer, decided: b.decided};
  const head = kind === 'stated_head' ? 'f'.repeat(64) : rows.at(-1)?.hash ?? GENESIS;
  const client = await checkClientRecord(scope, {entries: rows.map(forClient), anchors: {1: server.anchor}, head, seal: {state: server.seal}});
  return {server, client};
}

test('B1: the in-browser check agrees with server verification on random tampering', async t => {
  const tally = {};
  await fc.assert(fc.asyncProperty(baselineArb, fc.array(opArb, {minLength: 2, maxLength: 10}), fc.nat(), fc.integer({min: 0, max: clientTampers.length - 1}), async (content, ops, pick, t) => {
    const b = await approve(content);
    const entries = await buildLedger(b, ops);
    fc.pre(entries.length > 0);
    const kind = clientTampers[t];
    const {server, client} = await scenario(b, entries, kind, pick % entries.length);
    const serverOk = server.chain.intact && server.seal !== 'invalid';
    const key = `${kind}: server=${serverOk ? 'ok' : 'fail'} client=${client.state}`;
    tally[key] = (tally[key] ?? 0) + 1;
    if (kind === 'stated_head') {
      // Documented difference: the server never states a head it did not compute, the
      // client additionally checks the stated head (defence against a lying response).
      assert.equal(client.state, 'failed');
      return;
    }
    assert.equal(client.state === 'ok', serverOk, key);
    if (kind === 'strip_signatures') {
      // Documented finding: stripping every signature downgrades the seal to "unsigned"
      // (legacy records) rather than failing; both sides still accept the record.
      assert.equal(server.seal, 'unsigned');
      assert.equal(client.state === 'ok' && client.signed, false);
    }
  }), {numRuns: 250});
  t.diagnostic(JSON.stringify(tally));
});

function moneyDelta() { return fc.integer({min: -100000, max: 100000}).map(c => c / 100); }
