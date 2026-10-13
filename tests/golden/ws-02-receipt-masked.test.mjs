// WS-02 golden: a receipt whose decision used a one-time code. Byte-exact (frozen clock, fixed key),
// and it names only the masked address the code went to, with the "on file since" date (C5), and
// the countersigner's masked address (H1). Regenerate deliberately with UPDATE_GOLDEN=1.
// @covers C5
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, writeFileSync, existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {freezeClock, tick} from '../support/property.mjs';

process.env.SCOPEFLOW_SIGNING_SECRET = 'scopeflow-golden-signing-secret-do-not-use-0123456789';
delete process.env.SCOPEFLOW_SIGNING_SECRET_PREVIOUS;
freezeClock();
const {scopeSchema, sample} = await import('../../lib/scope.ts');
const {publicSigningKey} = await import('../../lib/signing.ts');
const {renderReceiptPdf, verifyUrl} = await import('../../lib/receipt.ts');
const {approve} = await import('../support/chain.mjs');

const drawn = pdf => [...pdf.matchAll(/\((?:[^()\\]|\\[()\\]|\\[0-7]{3})*\) Tj/g)].map(m => m[0].slice(1, -4).replace(/\\([0-7]{3})/g, (_, o) => String.fromCharCode(parseInt(o, 8))).replace(/\\([()\\])/g, '$1')).join(' ');

test('golden: masked-address receipt', async () => {
  const content = scopeSchema.parse({...sample, due: '2026-12-15'});
  const b = await approve(content, {project_id: 'golden-project-0002', version: 1, signer: 'Sam Client', decided: tick(0)});
  const key = publicSigningKey();
  const model = {
    project_id: b.project_id, version: 1, status: 'approved', content,
    content_sha256: createHash('sha256').update(JSON.stringify(content)).digest('hex'),
    signer: b.signer, decided: b.decided, comment: null, anchor: b.anchor, signature: b.signature, key: {kid: key.kid, x: key.x},
    context: {channel: 'review_link', ip: '203.0.113.9', user_agent: 'Mozilla/5.0 (Golden)', owner_session: true, via_api: false, acknowledged: true,
      identity: {method: 'email_otp', email: 'sam@example.com', verified_at: tick(-30), otp_id: 'otp-golden'}, identity_signature: key.kid + '.' + 'Q'.repeat(86), contact_since: '2026-10-03T04:30:00.000Z'},
    ledger: null, cosigns: [{role: 'Finance approver', signer: 'Fin Ance', signed: tick(120), signature: key.kid + '.' + 'R'.repeat(86), verified_to: 'f***@e***.com'}],
    seal: 'dedicated', time_zone: 'Asia/Kolkata', generated: tick(600),
    verify_url: verifyUrl('https://scopeflow.example', b.project_id, 1, b.anchor),
  };
  const bytes = renderReceiptPdf(model);
  const t = drawn(Buffer.from(bytes).toString('latin1'));
  for (const needle of ['code verified to s***@e***.com (the address on file since 3 Oct 2026)', 'Approved by whoever held this link, after entering a code sent to s***@e***.com, the address on file for this client since 3 Oct 2026.', 'Warning: Submitted from a browser signed in to the creator', 'Finance approver: Fin Ance (code verified to f***@e***.com)', `Sealed by ScopeFlow (Ed25519, key ${key.kid})`]) assert.ok(t.includes(needle), 'missing: ' + needle);
  assert.ok(!t.includes('sam@example.com'), 'never the full address');
  const file = new URL('./ws-02-receipt-masked.golden.json', import.meta.url);
  const value = JSON.stringify({sha256: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length}, null, 2) + '\n';
  if (process.env.UPDATE_GOLDEN === '1' || !existsSync(file)) writeFileSync(file, value);
  assert.equal(value, readFileSync(file, 'utf8'), 'masked receipt PDF changed; run with UPDATE_GOLDEN=1 only if intended');
});
