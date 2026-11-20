import {describe, it} from 'node:test';
import assert from 'node:assert/strict';
import {
  parseSealedEvidenceRecord,
  sealEvidenceText,
  verifySealedEvidenceRecord,
} from './evidence-seal';

describe('evidence-seal SHA-256 round-trip & tamper detection', () => {
  it('seals and verifies an unmodified record cleanly (including CRLF copy/paste)', async () => {
    const sealed = await sealEvidenceText(
      'MOVE-IN RECORD — Flat 402, Palm Grove\nDeposit: ₹1,50,000\nUPI UTR: 4291083910',
      '2026-11-20T12:00:00.000Z',
    );
    assert.match(sealed.hash, /^[a-f0-9]{64}$/);
    const ok = await verifySealedEvidenceRecord(sealed.record);
    assert.equal(ok.status, 'valid');
    if (ok.status === 'valid') {
      assert.equal(ok.computedHash, sealed.hash);
    }
    // Windows clipboard CRLF normalization must still verify cleanly
    const crlf = sealed.record.replace(/\n/g, '\r\n') + '\r\n';
    const okCrlf = await verifySealedEvidenceRecord(crlf);
    assert.equal(okCrlf.status, 'valid');
  });

  it('detects even a single-digit tamper in the deposit amount', async () => {
    const sealed = await sealEvidenceText(
      'MOVE-IN RECORD — Flat 402\nDeposit: ₹1,50,000',
      '2026-11-20T12:00:00.000Z',
    );
    const tampered = sealed.record.replace('₹1,50,000', '₹1,20,000');
    const res = await verifySealedEvidenceRecord(tampered);
    assert.equal(res.status, 'tampered');
    if (res.status === 'tampered') {
      assert.notEqual(res.computedHash, res.expectedHash);
    }
  });

  it('rejects malformed input cleanly without throwing', async () => {
    const empty = parseSealedEvidenceRecord('   ');
    assert.equal(empty.ok, false);
    const noSeal = await verifySealedEvidenceRecord('Just some plain text');
    assert.equal(noSeal.status, 'invalid_format');
    const shortHash = await verifySealedEvidenceRecord('Body text\nSHA-256 Fingerprint: abc123');
    assert.equal(shortHash.status, 'invalid_format');
  });
});
