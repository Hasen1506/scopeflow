import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {buildAuditExport, type AuditRows} from './audit-export';
import {toAuditPdf} from './audit-export-pdf';
import {resolveAccountSaveTarget} from './account-shortcut';

const sha = (s: string) => createHash('sha256').update(s).digest('hex');

const sampleRows: AuditRows = {
  projects: [
    {
      id: 'proj_1',
      title: 'Flat 402 Security Deposit Record',
      created: '2026-10-01T10:00:00Z',
      archived: null,
      legal_hold: true,
      legal_hold_reason: 'Move-out inspection pending',
      legal_hold_set: '2026-10-15T09:00:00Z',
      retention_days: 365,
      owner_deleted: null,
      retain_until: null,
    },
  ],
  decisions: [
    {
      project_id: 'proj_1',
      version: 1,
      status: 'approved',
      signer: 'Rajesh Sharma',
      decided: '2026-10-02T11:30:00Z',
      signature: 'ed25519:sig1234567890abcdef',
      anchor: 'a'.repeat(64),
    },
  ],
  entries: [
    {
      project_id: 'proj_1',
      seq: 1,
      kind: 'change_order',
      baseline_version: 1,
      actor: 'owner',
      created: '2026-10-05T14:00:00Z',
      prev_hash: '0'.repeat(64),
      hash: 'b'.repeat(64),
      signature: 'ed25519:entrysig',
      payload: '{"delta":5000}',
    },
  ],
  cosigns: [
    {
      project_id: 'proj_1',
      version: 1,
      cosigner_id: 'cs_1',
      role: 'Co-tenant',
      signer: 'Ananya Rao',
      signed: '2026-10-02T12:00:00Z',
      signature: 'ed25519:cosignsig',
    },
  ],
  access: [
    {
      project_id: 'proj_1',
      version: 1,
      first_viewed: '2026-10-02T11:20:00Z',
      last_viewed: '2026-10-02T11:29:00Z',
      views: 3,
    },
  ],
  admin: [
    {
      id: 'adm_1',
      kind: 'legal_hold.enabled',
      detail: '{"project_id":"proj_1"}',
      actor: 'owner',
      created: '2026-10-15T09:00:00Z',
    },
  ],
  contacts: [
    {
      project_id: 'proj_1',
      at: '2026-10-03T08:00:00Z',
      detail: {field: 'email', after: 'rajesh@example.com'},
    },
  ],
};

test('toAuditPdf generates a valid, deterministic PDF with summary, events, and cryptographic seal', () => {
  const records = buildAuditExport(
    sampleRows,
    {
      owner_ref: 'own_1234567890abcdef',
      from: '2026-10-01',
      to: '2026-11-01',
      generated: '2026-11-01T00:00:00Z',
      account_retention_days: 365,
      mode: 'enterprise',
      key_id: 'key_demo_01',
    },
    sha,
    msg => 'sig_' + sha(msg).slice(0, 16),
  );

  const bytes1 = toAuditPdf(records);
  const bytes2 = toAuditPdf(records);
  assert.deepEqual(bytes1, bytes2, 'PDF bytes must be deterministic');

  const text = Buffer.from(bytes1).toString('latin1');
  assert.ok(text.startsWith('%PDF-1.4\n'), 'Must start with PDF 1.4 header');
  assert.ok(text.trimEnd().endsWith('%%EOF'), 'Must end with %%EOF');
  assert.match(text, /Account Audit Trail Report/);
  assert.match(text, /Flat 402 Security Deposit Record/);
  assert.match(text, /LEGAL HOLD/);
  assert.match(text, /Rajesh Sharma/);
  assert.match(text, /CRYPTOGRAPHIC INTEGRITY SEAL/);
  assert.match(text, /key_demo_01/);
});

test('toAuditPdf paginates cleanly across multiple pages for large audit trails', () => {
  const manyAdmin = Array.from({length: 45}, (_, i) => ({
    id: `adm_${i + 1}`,
    kind: 'audit.exported',
    detail: `{"seq":${i + 1}}`,
    actor: 'owner',
    created: `2026-10-${String((i % 28) + 1).padStart(2, '0')}T10:00:00Z`,
  }));
  const records = buildAuditExport(
    {...sampleRows, admin: manyAdmin},
    {
      owner_ref: 'own_bulk',
      from: '2026-10-01',
      to: '2026-11-01',
      generated: '2026-11-01T00:00:00Z',
      account_retention_days: 180,
      mode: 'freelancer',
      key_id: null,
    },
    sha,
    () => null,
  );
  const text = Buffer.from(toAuditPdf(records)).toString('latin1');
  assert.match(text, /page 1/);
  assert.match(text, /page 2/);
  assert.match(text, /Server Ed25519 signing key was not configured/);
});

test('resolveAccountSaveTarget prioritizes focused section, then dirty section(s), then fallback', () => {
  const base = {
    inWording: false,
    inBusiness: false,
    wordingDirty: false,
    businessDirty: false,
    hasSettings: true,
    hasProfile: true,
    profileBlocked: false,
  };

  // Focus inside Your wording always targets settings
  assert.equal(resolveAccountSaveTarget({...base, inWording: true, businessDirty: true}), 'settings');
  // Focus inside Business details targets profile unless blocked
  assert.equal(resolveAccountSaveTarget({...base, inBusiness: true, wordingDirty: true}), 'profile');
  assert.equal(resolveAccountSaveTarget({...base, inBusiness: true, profileBlocked: true}), 'none');
  // Focus outside saves dirty section(s)
  assert.equal(resolveAccountSaveTarget({...base, wordingDirty: true}), 'settings');
  assert.equal(resolveAccountSaveTarget({...base, businessDirty: true}), 'profile');
  assert.equal(resolveAccountSaveTarget({...base, wordingDirty: true, businessDirty: true}), 'both');
  assert.equal(resolveAccountSaveTarget({...base, wordingDirty: true, businessDirty: true, profileBlocked: true}), 'settings');
  // Clean outside defaults to available settings
  assert.equal(resolveAccountSaveTarget(base), 'settings');
  assert.equal(resolveAccountSaveTarget({...base, hasSettings: false, hasProfile: false}), 'none');
});
