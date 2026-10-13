// Invariants of canonical scope hashing and signed-content verification.
import '../support/fc-setup.mjs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fc, scopeArb, shuffleKeys, prng, freezeClock, tick} from '../support/property.mjs';
import {approve, anchorHash, sha256, verifyRecord, anchorMessage} from '../support/chain.mjs';

freezeClock();
const {scopeSchema} = await import('../../lib/scope.ts');
const canon = x => JSON.stringify(scopeSchema.parse(x));
const validScope = scopeArb.filter(s => scopeSchema.safeParse(s).success);

test('canonical form ignores object key order (top level and inside items)', () => {
  fc.assert(fc.property(validScope, fc.integer(), (s, seed) => {
    assert.equal(canon(shuffleKeys(s, prng(seed))), canon(s));
  }));
});

test('canonicalisation is idempotent: storing, reading and re-validating changes nothing', () => {
  fc.assert(fc.property(validScope, s => {
    const once = scopeSchema.parse(s);
    const stored = JSON.stringify(once);
    // The server hashes JSON.stringify(JSON.parse(row.content)); it must equal what was stored.
    assert.equal(JSON.stringify(JSON.parse(stored)), stored);
    assert.equal(JSON.stringify(scopeSchema.parse(JSON.parse(stored))), stored);
  }));
});

test('surrounding whitespace in text fields is not significant', () => {
  fc.assert(fc.property(validScope, fc.constantFrom(' ', '\n', '\t ', '  \n'), (s, pad) => {
    const padded = {...s, title: pad + s.title + pad, client: pad + s.client, notes: s.notes + pad, items: s.items.map(i => ({...i, title: pad + i.title}))};
    assert.equal(canon(padded), canon(s));
  }));
});

test('deliverable order is significant (reordering is a content change)', () => {
  return fc.assert(fc.asyncProperty(validScope.filter(s => s.items.length >= 2), async s => {
    const a = scopeSchema.parse(s);
    const b = scopeSchema.parse({...s, items: [...s.items].reverse()});
    assert.notEqual(JSON.stringify(a), JSON.stringify(b));
    const base = {project_id: 'p', version: 1, signer: 'S', decided: tick(0)};
    assert.notEqual(await anchorHash({...base, content: a}), await anchorHash({...base, content: b}));
  }));
});

test('anchor hashing is stable across calls and across a storage round trip', () => {
  return fc.assert(fc.asyncProperty(validScope, idArbSafe(), async (s, pid) => {
    const content = scopeSchema.parse(s);
    const a = {project_id: pid, version: 3, content, signer: 'Signer', decided: tick(5)};
    const h1 = await anchorHash(a), h2 = await anchorHash({...a, content: JSON.parse(JSON.stringify(content))});
    assert.match(h1, /^[a-f0-9]{64}$/);
    assert.equal(h1, h2);
  }));
});

// Paths into the signed content and a way to change each one to a different valid value.
const mutations = [
  ['title', s => ({...s, title: s.title + ' v2'})],
  ['client', s => ({...s, client: s.client + ' Ltd'})],
  ['fee', s => ({...s, fee: s.fee === 0 ? 1 : 0})],
  ['fee by one cent', s => ({...s, fee: Math.round((s.fee + 0.01) * 100) / 100})],
  ['currency', s => ({...s, currency: s.currency === 'USD' ? 'EUR' : 'USD'})],
  ['revisions', s => ({...s, revisions: (s.revisions + 1) % 7})],
  ['due', s => ({...s, due: s.due === '2027-01-01' ? '2027-01-02' : '2027-01-01'})],
  ['exclusions', s => ({...s, exclusions: s.exclusions + ' Hosting.'})],
  ['notes', s => ({...s, notes: s.notes + ' Net 30.'})],
  ['item title', s => ({...s, items: s.items.map((i, n) => (n === 0 ? {...i, title: i.title + '!'} : i))})],
  ['item qty', s => ({...s, items: s.items.map((i, n) => (n === 0 ? {...i, qty: i.qty + 1} : i))})],
  ['item price', s => ({...s, items: s.items.map((i, n) => (n === 0 ? {...i, price: i.price === null ? 1 : null} : i))})],
  ['item unit', s => ({...s, items: s.items.map((i, n) => (n === 0 ? {...i, unit: i.unit === 'pages' ? 'hours' : 'pages'} : i))})],
  ['item acceptance', s => ({...s, items: s.items.map((i, n) => (n === 0 ? {...i, acceptance: i.acceptance + ' signed off'} : i))})],
  ['item id', s => ({...s, items: s.items.map((i, n) => (n === 0 ? {...i, id: 'renamed_' + n} : i))})],
  ['drop an item', s => ({...s, items: s.items.length > 1 ? s.items.slice(1) : [...s.items, {id: 'zz_extra', title: 'Item extra'}]})],
  ['client input', s => ({...s, client_inputs: [...s.client_inputs.filter(c => c.id !== 'zz_in'), {id: 'zz_in', title: 'Input extra', due: ''}]})],
];

test('any mutation of signed content changes the hash and fails signature verification', () => {
  return fc.assert(fc.asyncProperty(validScope, fc.integer({min: 0, max: mutations.length - 1}), async (s, m) => {
    const content = scopeSchema.parse(s);
    const [name, mutate] = mutations[m];
    const parsed = scopeSchema.safeParse(mutate(s));
    fc.pre(parsed.success);
    const changed = parsed.data;
    const receipt = await approve(content);
    assert.equal(verifyRecord(anchorMessage(receipt.anchor), receipt.signature), 'valid');
    // Content hash the review page sends (SF-15) and the anchor the receipt commits to.
    assert.notEqual(await sha256(JSON.stringify(changed)), await sha256(JSON.stringify(content)), name);
    const forged = await anchorHash({...receipt, content: changed});
    assert.notEqual(forged, receipt.anchor, name);
    assert.equal(verifyRecord(anchorMessage(forged), receipt.signature), 'invalid', name);
  }));
});

test('changing who signed, when, which version or which project breaks the receipt', () => {
  const fields = [['signer', r => ({...r, signer: r.signer + 'x'})], ['decided', r => ({...r, decided: tick(1)})], ['version', r => ({...r, version: r.version + 1})], ['project_id', r => ({...r, project_id: r.project_id + 'x'})]];
  return fc.assert(fc.asyncProperty(validScope, fc.integer({min: 0, max: fields.length - 1}), async (s, f) => {
    const receipt = await approve(scopeSchema.parse(s));
    const forged = await anchorHash(fields[f][1](receipt));
    assert.notEqual(forged, receipt.anchor);
    assert.equal(verifyRecord(anchorMessage(forged), receipt.signature), 'invalid');
  }));
});

test('a signature never verifies with a flipped bit or under a different key id', () => {
  return fc.assert(fc.asyncProperty(validScope, fc.nat(), async (s, n) => {
    const receipt = await approve(scopeSchema.parse(s));
    const [kid, sig] = receipt.signature.split('.');
    const bytes = Buffer.from(sig, 'base64url');
    bytes[n % bytes.length] ^= 1 << (n % 8);
    assert.equal(verifyRecord(anchorMessage(receipt.anchor), kid + '.' + bytes.toString('base64url')), 'invalid');
    assert.equal(verifyRecord(anchorMessage(receipt.anchor), '0000000000000000.' + sig), 'invalid');
    assert.equal(verifyRecord(anchorMessage(receipt.anchor), null), 'unsigned');
  }));
});

function idArbSafe() { return fc.stringMatching(/^[a-z0-9-]{1,36}$/); }
