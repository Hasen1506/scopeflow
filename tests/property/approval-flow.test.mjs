// Core approval contract, without a database: a decision is refused unless the reviewer
// typed a name, acknowledged the version, and sent the fingerprint of the content they saw.
// A change request needs a comment. A decided or expired link takes no new decision.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import '../support/ts-resolve.mjs';

const {canonical, contentFingerprint, decisionProblem} = await import('../../lib/evidence.ts');
const {linkExpired, linkExpires} = await import('../../lib/link.ts');

const hash = 'a'.repeat(64);
const ok = {decision: 'approved', signer: 'Ada Client', comment: '', version: 1, acknowledged: true, content_sha256: hash};

test('an approval is accepted only with a name, an acknowledgement, and the content fingerprint', () => {
  assert.equal(decisionProblem(ok), null);
  assert.equal(decisionProblem({...ok, decision: 'changes_requested', comment: 'Please drop printing.'}), null);
  assert.match(decisionProblem({...ok, acknowledged: false}), /confirm you reviewed/i);
  assert.match(decisionProblem({...ok, signer: 'A'}), /confirm you reviewed/i);
  assert.match(decisionProblem({...ok, content_sha256: 'abc'}), /confirm you reviewed/i);
  assert.match(decisionProblem({...ok, extra: true}), /confirm you reviewed/i);
  assert.match(decisionProblem({...ok, decision: 'changes_requested', comment: '   '}), /describe the changes/i);
});

test('the fingerprint is the hash of the exact content the reviewer was shown', async () => {
  const shown = {title: 'Logo suite', fee: 500, exclusions: 'Printing'};
  const fingerprint = await contentFingerprint(shown);
  assert.equal(fingerprint, await contentFingerprint(JSON.parse(canonical(shown))));
  assert.equal(fingerprint.length, 64);
  assert.notEqual(fingerprint, await contentFingerprint({...shown, fee: 600}));
  assert.equal(decisionProblem({...ok, content_sha256: fingerprint}), null);
});

test('a pending link can expire; an approved link stays as the client record', () => {
  const issued = '2026-01-01T00:00:00.000Z';
  const pending = {status: 'pending', created: issued, link_expiry_days: 14};
  assert.equal(linkExpires(pending), '2026-01-15T00:00:00.000Z');
  assert.equal(linkExpired(pending, Date.parse('2026-01-14T00:00:00.000Z')), false);
  assert.equal(linkExpired(pending, Date.parse('2026-01-15T00:00:00.000Z')), true);
  assert.equal(linkExpires({status: 'approved', created: issued, link_expiry_days: 14}), null);
  assert.equal(linkExpired({status: 'approved', created: issued, link_expiry_days: 14}, Date.parse('2027-01-01T00:00:00.000Z')), false);
});
