// SF-25: the audit export's record schema (golden) and its seal. Built by the real lib code from
// fixed rows, signed with a fixed key: byte-exact. Regenerate deliberately with UPDATE_GOLDEN=1.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash, createPublicKey, verify} from 'node:crypto';
import {readFileSync, writeFileSync} from 'node:fs';
import '../support/property.mjs';

process.env.SCOPEFLOW_SIGNING_SECRET = 'scopeflow-golden-signing-secret-do-not-use-0123456789';
delete process.env.SCOPEFLOW_SIGNING_SECRET_PREVIOUS;
const A = await import('../../lib/audit-export.ts');
const {signRecord, publicSigningKey} = await import('../../lib/signing.ts');
const sha = s => createHash('sha256').update(s).digest('hex');
const H = c => c.repeat(64);

const rows = {
  projects: [
    {id: 'p1', title: 'Brand refresh', created: '2026-09-01T10:00:00.000Z', archived: null, legal_hold: false, legal_hold_reason: null, legal_hold_set: null, retention_days: null, owner_deleted: null, retain_until: null},
    {id: 'p2', title: 'Kitchen BOQ', created: '2026-09-02T10:00:00.000Z', archived: '2026-10-01T00:00:00.000Z', legal_hold: true, legal_hold_reason: 'Dispute', legal_hold_set: '2026-10-02T00:00:00.000Z', retention_days: 365, owner_deleted: null, retain_until: null},
  ],
  decisions: [{project_id: 'p1', version: 1, status: 'approved', signer: 'Ada', decided: '2026-09-05T12:00:00.000Z', signature: 'kid.sig1', anchor: H('a')}, {project_id: 'p2', version: 1, status: 'approved', signer: 'Ravi', decided: '2025-01-01T00:00:00.000Z', signature: 'kid.sig2', anchor: H('b')}],
  entries: [
    {project_id: 'p1', seq: 2, kind: 'payment_received', baseline_version: 1, actor: 'owner', created: '2026-09-07T00:00:00.000Z', prev_hash: H('c'), hash: H('d'), signature: 'kid.e2', payload: '{"amount":3000}'},
    {project_id: 'p1', seq: 1, kind: 'change_order', baseline_version: 1, actor: 'owner', created: '2026-09-06T00:00:00.000Z', prev_hash: H('0'), hash: H('c'), signature: 'kid.e1', payload: '{"title":"CO-1"}'},
  ],
  cosigns: [{project_id: 'p1', version: 1, cosigner_id: 'fin', role: 'Finance', signer: 'Meera', signed: '2026-09-05T13:00:00.000Z', signature: 'kid.c1'}],
  access: [{project_id: 'p1', version: 1, first_viewed: '2026-09-04T00:00:00.000Z', last_viewed: '2026-09-05T11:00:00.000Z', views: 3}],
  admin: [{id: 'ev1', kind: 'mode.changed', detail: '{"from":"freelancer","to":"enterprise"}', actor: 'session', created: '2026-09-03T00:00:00.000Z'}],
  contacts: [{project_id: 'p1', at: '2026-09-04T09:00:00.000Z', detail: {from_masked: 'a***@e***.com', to_masked: 'b***@e***.com'}}],
};
const meta = {owner_ref: 'ref123', from: '2026-01-01', to: '2026-10-08', generated: '2026-10-07T09:00:00.000Z', account_retention_days: 180, mode: 'enterprise', key_id: publicSigningKey().kid};

// @covers SF-25
test('audit export: schema snapshot (golden), date range, head hashes, retention and legal-hold state', () => {
  const records = A.buildAuditExport(rows, meta, sha, signRecord);
  const jsonl = A.toJsonl(records), file = new URL('./ws-08-audit-export.golden.jsonl', import.meta.url);
  if (process.env.UPDATE_GOLDEN) writeFileSync(file, jsonl);
  assert.equal(jsonl, readFileSync(file, 'utf8'));
  // Schema: every record type with its exact key set.
  const schema = Object.fromEntries([...new Map(records.map(r => [r.type, Object.keys(r).sort()]))]);
  assert.deepEqual(schema, {
    export: ['account_retention_days', 'counts', 'format', 'from', 'generated', 'key_id', 'mode', 'owner_ref', 'to', 'type'],
    project: ['archived', 'closed_account', 'created', 'effective_retention_days', 'ledger_count', 'ledger_head', 'legal_hold', 'legal_hold_reason', 'legal_hold_set', 'owner_deleted', 'project_id', 'retain_until', 'retention_days', 'title', 'type'],
    decision: ['anchor', 'at', 'project_id', 'signature', 'signer', 'status', 'type', 'verify', 'version'],
    ledger_entry: ['actor', 'at', 'baseline_version', 'hash', 'kind', 'payload', 'prev_hash', 'project_id', 'seq', 'signature', 'type'],
    cosign: ['at', 'cosigner_id', 'project_id', 'role', 'signature', 'signer', 'type', 'version'],
    contact_change: ['at', 'detail', 'project_id', 'type'],
    access: ['at', 'first_viewed', 'project_id', 'type', 'version', 'views'],
    admin: ['actor', 'at', 'detail', 'id', 'kind', 'type'],
    seal: ['format', 'key_id', 'lines', 'sha256', 'signature', 'type'],
  });
  const p1 = records.find(r => r.type === 'project' && r.project_id === 'p1'), p2 = records.find(r => r.type === 'project' && r.project_id === 'p2');
  assert.equal(p1.ledger_head, H('d')); assert.equal(p1.ledger_count, 2); assert.equal(p1.effective_retention_days, 180);
  assert.equal(p2.legal_hold, true); assert.equal(p2.effective_retention_days, 365); assert.equal(p2.ledger_head, H('0'));
  // The 2025 decision is outside the range; the export line counts it out.
  assert.deepEqual(records.filter(r => r.type === 'decision').map(r => r.project_id), ['p1']);
  assert.equal(records.find(r => r.type === 'decision').verify, `/api/verify?p=p1&v=1&a=${H('a')}`);
  assert.equal(records[0].counts.decision, 1);
});

// @covers SF-25
test('audit export: the seal covers every line and verifies with the published key; any change breaks it', () => {
  const jsonl = A.toJsonl(A.buildAuditExport(rows, meta, sha, signRecord));
  assert.equal(A.sealDigestMatches(jsonl, sha), true);
  const seal = JSON.parse(jsonl.trimEnd().split('\n').at(-1));
  const jwk = publicSigningKey(), key = createPublicKey({key: {kty: 'OKP', crv: 'Ed25519', x: jwk.x}, format: 'jwk'});
  assert.equal(verify(null, Buffer.from(A.auditSealMessage(seal.sha256)), key, Buffer.from(seal.signature.split('.')[1], 'base64url')), true);
  const tampered = jsonl.replace('"signer":"Ada"', '"signer":"Eve"');
  assert.notEqual(tampered, jsonl);
  assert.equal(A.sealDigestMatches(tampered, sha), false);
  const dropped = jsonl.split('\n').filter(l => !l.includes('"type":"access"')).join('\n');
  assert.equal(A.sealDigestMatches(dropped, sha), false);
});

// @covers SF-25
test('audit CSV: one row per record, formula injection neutralised', () => {
  const evil = {...rows, decisions: [{...rows.decisions[0], signer: '=HYPERLINK("http://x")'}]};
  const csv = A.toCsv(A.buildAuditExport(evil, meta, sha, signRecord));
  const lines = csv.trimEnd().split('\r\n');
  assert.equal(lines[0], A.CSV_COLUMNS.join(','));
  assert.equal(lines.length, 1 + A.buildAuditExport(evil, meta, sha, signRecord).length);
  assert.ok(!/,=HYPERLINK/.test(csv));
  assert.ok(lines.every(l => !l.startsWith('=')));
  assert.equal(A.toCsv([{type: 'admin', id: '=1', kind: '+cmd', actor: '@x', at: '-1', detail: null}]).split('\r\n')[1].split(',').filter(c => /^[=+@-]/.test(c)).length, 0);
});
