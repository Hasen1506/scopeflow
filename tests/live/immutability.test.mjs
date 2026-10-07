// Database-level invariants (SF-04 triggers, migration 0002): a signed version and the
// ledger are immutable whatever SQL is attempted, with or without the per-project
// "drafts" bypass. Needs only the migrated scopeflow_test database.
import {test, before, after} from 'node:test';
import assert from 'node:assert/strict';
import {fc, SEED} from '../support/property.mjs';
import {database} from './support.mjs';

const P = `prop-immut-${SEED}-${process.pid}`;
let db;
before(async () => {
  db = await database();
  await db.query('BEGIN');
  await db.query(`INSERT INTO scopeflow.projects (id,owner,latest,created) VALUES ($1,'prop-immut-owner',2,'2026-10-07T09:00:00.000Z')`, [P]);
  await db.query(`INSERT INTO scopeflow.versions (id,project_id,version,token,content,status,signer,comment,created,decided,signature,decision_context) VALUES
    ($1||'-v1',$1,1,md5($1||'1')||md5($1||'a'),'{"title":"Signed"}','approved','Ada Client','', '2026-10-07T09:00:00.000Z','2026-10-07T09:05:00.000Z','kid.sig','{}'),
    ($1||'-v2',$1,2,md5($1||'2')||md5($1||'b'),'{"title":"Draft"}','pending',NULL,NULL,'2026-10-07T09:10:00.000Z',NULL,NULL,NULL)`, [P]);
  await db.query(`INSERT INTO scopeflow.ledger_entries (id,project_id,seq,kind,baseline_version,actor,payload,ref,prev_hash,hash,created,signature) VALUES
    ($1||'-e1',$1,1,'change_order',1,'owner','{"title":"CO"}',NULL,repeat('0',64),repeat('a',64),'2026-10-07T09:06:00.000Z','kid.s1'),
    ($1||'-e2',$1,2,'settle',1,'client','{"ref_seq":1}','settle:1',repeat('a',64),repeat('b',64),'2026-10-07T09:07:00.000Z','kid.s2')`, [P]);
  await db.query('COMMIT');
});
after(async () => {
  await db.query('BEGIN');
  await db.query(`SELECT set_config('scopeflow.allow_delete','on',true), set_config('scopeflow.account_delete','on',true)`);
  await db.query('DELETE FROM scopeflow.ledger_entries WHERE project_id=$1', [P]);
  await db.query('DELETE FROM scopeflow.versions WHERE project_id=$1', [P]);
  await db.query('DELETE FROM scopeflow.projects WHERE id=$1', [P]);
  await db.query('COMMIT');
  await db.end();
});

/** Runs `sql` in a transaction that is always rolled back; returns the error code or 'ok'. */
async function attempt(sql, params = [], settings = []) {
  await db.query('BEGIN');
  try {
    for (const s of settings) await db.query(`SELECT set_config($1,'on',true)`, [s]);
    const r = await db.query(sql, params);
    return {code: 'ok', rows: r.rowCount};
  } catch (e) {
    return {code: e.code, message: e.message};
  } finally {
    await db.query('ROLLBACK');
  }
}
const textValue = fc.oneof(fc.string({maxLength: 40}).filter(s => !s.includes('\0')), fc.constantFrom('', 'approved', 'pending', '{"title":"Forged"}', 'x'.repeat(200)));
const versionColumns = ['id', 'project_id', 'version', 'content', 'created', 'status', 'signer', 'comment', 'decided', 'signature', 'decision_context'];
const value = (col, s, n) => (col === 'version' ? n : col === 'project_id' ? P : s);
const bypasses = fc.constantFrom([], ['scopeflow.allow_delete']);

test('a decided version rejects every change to its content or decision', async () => {
  await fc.assert(fc.asyncProperty(fc.constantFrom(...versionColumns), textValue, fc.integer({min: 3, max: 1000}), bypasses, async (col, s, n, settings) => {
    // Writing a column's current value back is a no-op the trigger allows; skip those.
    const current = (await db.query(`SELECT ${col}::text AS v FROM scopeflow.versions WHERE id=$1`, [P + '-v1'])).rows[0].v;
    fc.pre(String(value(col, s, n)) !== current);
    const r = await attempt(`UPDATE scopeflow.versions SET ${col}=$1 WHERE id=$2`, [value(col, s, n), P + '-v1'], settings);
    assert.equal(r.code, 'P0001', `${col}=${JSON.stringify(s)} was accepted`);
  }), {numRuns: 120});
});

test('review-link management stays possible on a decided version (token rotation, revocation)', async () => {
  assert.equal((await attempt(`UPDATE scopeflow.versions SET revoked=1 WHERE id=$1`, [P + '-v1'])).code, 'ok');
  assert.equal((await attempt(`UPDATE scopeflow.versions SET token=md5(random()::text)||md5(random()::text) WHERE id=$1`, [P + '-v1'])).code, 'ok');
});

test('a pending version accepts a decision but never a content change', async () => {
  await fc.assert(fc.asyncProperty(fc.constantFrom('id', 'version', 'content', 'created'), textValue, fc.integer({min: 3, max: 1000}), async (col, s, n) => {
    const r = await attempt(`UPDATE scopeflow.versions SET ${col}=$1 WHERE id=$2`, [value(col, s, n), P + '-v2']);
    assert.equal(r.code, 'P0001', col);
  }), {numRuns: 40});
  assert.equal((await attempt(`UPDATE scopeflow.versions SET status='approved',signer='Ada',decided='2026-10-07T10:00:00.000Z' WHERE id=$1`, [P + '-v2'])).code, 'ok');
});

const ledgerColumns = ['id', 'seq', 'kind', 'baseline_version', 'actor', 'payload', 'ref', 'prev_hash', 'hash', 'created', 'signature', 'context'];
test('ledger entries are append-only: every UPDATE is refused', async () => {
  await fc.assert(fc.asyncProperty(fc.constantFrom(...ledgerColumns), textValue, fc.integer({min: 3, max: 1000}), fc.constantFrom([], ['scopeflow.allow_delete'], ['scopeflow.allow_delete', 'scopeflow.account_delete']), fc.constantFrom('-e1', '-e2'), async (col, s, n, settings, e) => {
    const v = ['seq', 'baseline_version'].includes(col) ? n : s;
    const r = await attempt(`UPDATE scopeflow.ledger_entries SET ${col}=$1 WHERE id=$2`, [v, P + e], settings);
    assert.equal(r.code, 'P0001', `${col} changed under ${settings.join('+') || 'no bypass'}`);
  }), {numRuns: 120});
});

test('deletes: signed records survive the per-project bypass; only account deletion removes them', async () => {
  const del = (table, id, settings) => attempt(`DELETE FROM scopeflow.${table} WHERE id=$1`, [id], settings);
  for (const settings of [[], ['scopeflow.allow_delete']]) {
    assert.equal((await del('versions', P + '-v1', settings)).code, 'P0001', 'decided version deleted with ' + settings);
    assert.equal((await del('ledger_entries', P + '-e1', settings)).code, 'P0001', 'ledger entry deleted with ' + settings);
  }
  assert.equal((await del('versions', P + '-v2', [])).code, 'P0001', 'pending version deleted without the bypass');
  assert.equal((await del('versions', P + '-v2', ['scopeflow.allow_delete'])).code, 'ok', 'drafts bypass removes a pending version');
  assert.equal((await del('ledger_entries', P + '-e1', ['scopeflow.allow_delete', 'scopeflow.account_delete'])).code, 'ok');
  // The account_delete flag alone (without allow_delete) is not a bypass.
  assert.equal((await del('ledger_entries', P + '-e1', ['scopeflow.account_delete'])).code, 'P0001');
  for (const table of ['versions', 'ledger_entries', 'projects']) assert.equal((await attempt(`TRUNCATE scopeflow.${table} CASCADE`)).code, 'P0001', 'truncate ' + table);
});

test('a project cannot be re-owned, re-dated or rolled back to an older version', async () => {
  for (const [col, v] of [['owner', 'someone-else'], ['created', '2020-01-01T00:00:00.000Z'], ['latest', 1], ['id', 'other']]) {
    assert.equal((await attempt(`UPDATE scopeflow.projects SET ${col}=$1 WHERE id=$2`, [v, P])).code, 'P0001', col);
  }
  assert.equal((await attempt(`UPDATE scopeflow.projects SET archived='2026-10-07T11:00:00.000Z' WHERE id=$1`, [P])).code, 'ok');
});
