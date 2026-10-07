// Byte-exact golden records: a signed approval receipt and a ledger, produced by the real
// lib code from fixed inputs on a frozen clock with a fixed signing secret. Ed25519 is
// deterministic, so every hash and signature is stable. A diff here means the canonical
// form, the hash inputs or the signing changed, and every receipt already handed to a
// client would stop verifying. Regenerate deliberately with UPDATE_GOLDEN=1.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, writeFileSync, existsSync} from 'node:fs';
import {createHash, createPublicKey, verify} from 'node:crypto';
import {freezeClock, tick} from '../support/property.mjs';

process.env.SCOPEFLOW_SIGNING_SECRET = 'scopeflow-golden-signing-secret-do-not-use-0123456789';
delete process.env.SCOPEFLOW_SIGNING_SECRET_PREVIOUS;
freezeClock();
const {scopeSchema, sample} = await import('../../lib/scope.ts');
const {computeAgreement} = await import('../../lib/ledger.ts');
const {publicSigningKey, verifyRecord, anchorMessage, entryMessage} = await import('../../lib/signing.ts');
const {approve, append} = await import('../support/chain.mjs');

const dir = new URL('./', import.meta.url);
function golden(name, value) {
  const file = new URL(name, dir);
  const text = JSON.stringify(value, null, 2) + '\n';
  if (process.env.UPDATE_GOLDEN === '1' || !existsSync(file)) writeFileSync(file, text);
  assert.equal(text, readFileSync(file, 'utf8'), `${name} changed; run with UPDATE_GOLDEN=1 only if the change is intended`);
}

const content = scopeSchema.parse({...sample, due: '2026-12-15'});
const ids = {project_id: 'golden-project-0001', version: 1, signer: 'Ada Client', decided: tick(0)};

test('golden: signed approval receipt', async () => {
  const b = await approve(content, ids);
  const receipt = {project_id: b.project_id, version: b.version, signer: b.signer, decided: b.decided, content_sha256: createHash('sha256').update(JSON.stringify(content)).digest('hex'), anchor: b.anchor, signature: b.signature, key: publicSigningKey()};
  golden('receipt.golden.json', receipt);
  // Independent re-derivation of the documented format (no lib code):
  // sha256("scopeflow-baseline-v1|<project>|<version>|<content JSON>|<signer>|<decided>")
  const spec = createHash('sha256').update(['scopeflow-baseline-v1', ids.project_id, ids.version, JSON.stringify(content), ids.signer, ids.decided].join('|')).digest('hex');
  assert.equal(receipt.anchor, spec);
  const [kid, sig] = receipt.signature.split('.');
  assert.equal(kid, receipt.key.kid);
  const key = createPublicKey({key: {kty: 'OKP', crv: 'Ed25519', x: receipt.key.x}, format: 'jwk'});
  assert.ok(verify(null, Buffer.from('scopeflow-anchor-v1:' + receipt.anchor), key, Buffer.from(sig, 'base64url')), 'receipt verifies with only the published public key');
});

test('golden: ledger JSON (change order, client approval, goodwill, revision round)', async () => {
  const b = await approve(content, ids);
  const entries = [];
  entries.push(await append(entries, b, 'change_order', {title: 'Instagram templates', reason: 'Social media templates are excluded', request_quote: 'Could you also do 6 Instagram templates?', add_items: [{id: 'co_insta', title: 'Instagram templates', qty: 6, unit: 'templates', price: 400, acceptance: ''}], remove_item_ids: [], fee_delta: 400, days_delta: 5, revisions_delta: 0}, 'owner', tick(60)));
  entries.push(await append(entries, b, 'settle', {ref_seq: 1, outcome: 'approved', signer: 'Ada Client', comment: ''}, 'client', tick(120)));
  entries.push(await append(entries, b, 'goodwill', {title: 'Favicon set', value: 80, hours: 1, note: '', visible: false, salt: '00000000-0000-4000-8000-000000000000'}, 'owner', tick(180)));
  entries.push(await append(entries, b, 'revision_round', {feedback_date: '2026-10-08', note: 'Logo colour feedback'}, 'owner', tick(240)));
  const agreement = computeAgreement(content, 1, entries);
  assert.equal(agreement.fee, 2200);
  assert.equal(agreement.due, '2026-12-20');
  golden('ledger.golden.json', {anchor: b.anchor, head: entries.at(-1).hash, entries, agreement});
  for (const e of entries) assert.equal(verifyRecord(entryMessage(e.hash), e.signature), 'valid');
  assert.equal(verifyRecord(anchorMessage(b.anchor), b.signature), 'valid');
});
