// Builds ledgers exactly the way lib/ledger-server.ts appendEntry does (same hash inputs,
// same payload serialisation, same signatures), but in memory and on a frozen clock.
import './ts-resolve.mjs';
import {fc, idArb, itemArb, moneyArb, tick} from './property.mjs';

process.env.SCOPEFLOW_SIGNING_SECRET ??= 'scopeflow-property-tests-signing-secret-0123456789';
const L = await import('../../lib/ledger.ts');
const S = await import('../../lib/signing.ts');
export const {anchorHash, entryHash, sha256, verifyChain, computeAgreement, checkEntry, payloadSchemas, GENESIS} = L;
export const {signRecord, verifyRecord, anchorMessage, entryMessage} = S;

/** One approved baseline: what the client signed. */
export async function approve(content, {project_id = 'p_prop', version = 1, signer = 'Client Signer', decided = tick(0)} = {}) {
  const anchor = await anchorHash({project_id, version, content, signer, decided});
  return {project_id, version, content, signer, decided, anchor, signature: signRecord(anchorMessage(anchor))};
}

/** Appends one entry (payload already validated). Returns the new entry with its signature. */
export async function append(entries, baseline, kind, payload, actor, at) {
  const prev = entries.at(-1);
  const text = JSON.stringify(payload);
  const entry = {seq: (prev?.seq ?? 0) + 1, kind, baseline_version: baseline.version, actor, created: at, payload_hash: await sha256(text), prev_hash: prev?.hash ?? GENESIS};
  const hash = await entryHash(entry, baseline.anchor);
  return {...entry, payload: JSON.parse(text), hash, signature: signRecord(entryMessage(hash))};
}

// Operations a ledger can receive. Ops that the server would reject (checkEntry) are skipped,
// so every generated ledger is one the real API could have produced.
export const opArb = fc.oneof(
  {weight: 4, arbitrary: fc.record({op: fc.constant('co'), title: fc.constantFrom('Extra page', 'More concepts', 'Rush delivery', 'Drop guide'), fee_delta: fc.oneof(moneyArb, moneyArb.map(x => -x), fc.constant(0)), revisions_delta: fc.integer({min: 0, max: 2}), add: fc.array(itemArb(idArb.map(x => 'co_' + x)), {maxLength: 2}), remove: fc.boolean()})},
  {weight: 4, arbitrary: fc.record({op: fc.constant('settle'), pick: fc.nat(), outcome: fc.constantFrom('approved', 'approved', 'declined', 'withdrawn')})},
  {weight: 1, arbitrary: fc.record({op: fc.constant('goodwill'), value: moneyArb, visible: fc.boolean()})},
  {weight: 1, arbitrary: fc.record({op: fc.constant('round'), day: fc.integer({min: 0, max: 60})})},
);

/** Applies generated ops to a baseline; returns entries plus the ops that were accepted. */
export async function buildLedger(baseline, ops) {
  const entries = [];
  let t = 1;
  for (const o of ops) {
    const agreement = computeAgreement(baseline.content, baseline.version, entries);
    let kind, payload, actor = 'owner';
    if (o.op === 'co') {
      const removable = agreement.items.map(i => i.id);
      payload = {title: o.title, reason: '', request_quote: '', add_items: o.add.map(i => ({...i})), remove_item_ids: o.remove && removable.length > 1 ? [removable[0]] : [], fee_delta: o.fee_delta, days_delta: 0, revisions_delta: o.revisions_delta};
      if (!payload.add_items.length && !payload.remove_item_ids.length && !payload.fee_delta && !payload.revisions_delta) payload.fee_delta = 1;
      kind = 'change_order';
    } else if (o.op === 'settle') {
      const open = agreement.change_orders.filter(c => c.status === 'proposed');
      if (!open.length) continue;
      const co = open[o.pick % open.length];
      actor = o.outcome === 'withdrawn' ? 'owner' : 'client';
      payload = {ref_seq: co.seq, outcome: o.outcome, signer: actor === 'client' ? 'Client Signer' : '', comment: o.outcome === 'declined' ? 'Not now' : ''};
      kind = 'settle';
    } else if (o.op === 'goodwill') {
      kind = 'goodwill'; payload = {title: 'Extra polish', value: o.value, hours: 0, note: '', visible: o.visible};
    } else {
      kind = 'revision_round'; payload = {feedback_date: tick(o.day * 86400).slice(0, 10), note: ''};
    }
    const parsed = payloadSchemas[kind].safeParse(payload);
    if (!parsed.success) continue;
    payload = parsed.data;
    if (checkEntry(kind, payload, baseline.content, agreement, actor)) continue;
    // SF-11: hidden goodwill is stored with a random salt; here it is derived from the position.
    if (kind === 'goodwill' && !payload.visible) payload = {...payload, salt: 'salt-' + (entries.length + 1)};
    entries.push(await append(entries, baseline, kind, payload, actor, tick(t++)));
  }
  return entries;
}

/** The client's view of an entry: hidden goodwill keeps only its payload hash. */
export const forClient = e => (e.kind === 'goodwill' && e.payload?.visible === false ? {...e, payload: null} : e);
/** Server-side verdict, as GET /api/scopes/:id/ledger computes it (chain + seal over every signature). */
export async function serverVerdict(baseline, entries) {
  const anchor = await anchorHash(baseline);
  const chain = await verifyChain(entries, {[baseline.version]: anchor});
  const states = [verifyRecord(anchorMessage(anchor), baseline.signature), ...entries.map(e => verifyRecord(entryMessage(e.hash), e.signature))];
  const seal = states.includes('invalid') ? 'invalid' : states.includes('unsigned') ? 'unsigned' : 'valid';
  return {chain, seal, anchor};
}
