// C7: immutability that holds against the runtime database role, not only against honest app code.
// Creates a throwaway login role granted scopeflow_app (as production's DATABASE_URL role is) and
// attacks the decided records with it directly. Needs only the migrated scopeflow_test database.
// @covers C7
import {test, before, after} from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import {SEED} from '../support/property.mjs';
import {database} from './support.mjs';

const P = `ws10-roles-${SEED}-${process.pid}`;
const ROLE = `sf_app_ci_${process.pid}`;
const PASSWORD = 'ci-only-' + process.pid;
let su, app;

before(async () => {
  su = await database();
  await su.query(`CREATE ROLE ${ROLE} LOGIN PASSWORD '${PASSWORD}' IN ROLE scopeflow_app`);
  const url = new URL(process.env.DATABASE_URL);
  url.username = ROLE; url.password = PASSWORD;
  app = new pg.Client({connectionString: url.href});
  await app.connect();
  await su.query('BEGIN');
  await su.query(`INSERT INTO scopeflow.projects (id,owner,latest,created) VALUES ($1,'ws10-roles-owner',1,'2026-10-07T09:00:00.000Z'), ($1||'-draft','ws10-roles-owner',1,'2026-10-07T09:00:00.000Z'), ($1||'-hold','ws10-roles-owner',1,'2026-10-07T09:00:00.000Z')`, [P]);
  await su.query(`UPDATE scopeflow.projects SET legal_hold=true WHERE id=$1||'-hold'`, [P]);
  await su.query(`INSERT INTO scopeflow.versions (id,project_id,version,token,content,status,signer,comment,created,decided,signature,decision_context) VALUES
    ($1||'-v1',$1,1,md5($1||'1')||md5($1||'a'),'{"title":"Signed"}','approved','Ada Client','','2026-10-07T09:00:00.000Z','2026-10-07T09:05:00.000Z','kid.sig','{}'),
    ($1||'-d1',$1||'-draft',1,md5($1||'2')||md5($1||'b'),'{"title":"Draft"}','pending',NULL,NULL,'2026-10-07T09:00:00.000Z',NULL,NULL,NULL),
    ($1||'-h1',$1||'-hold',1,md5($1||'3')||md5($1||'c'),'{"title":"Held draft"}','pending',NULL,NULL,'2026-10-07T09:00:00.000Z',NULL,NULL,NULL)`, [P]);
  await su.query(`INSERT INTO scopeflow.ledger_entries (id,project_id,seq,kind,baseline_version,actor,payload,ref,prev_hash,hash,created,signature) VALUES ($1||'-e1',$1,1,'goodwill',1,'owner','{"title":"TEST"}',NULL,repeat('0',64),repeat('a',64),'2026-10-07T09:06:00.000Z','kid.s1')`, [P]);
  await su.query('COMMIT');
});
after(async () => {
  await app?.end();
  await su.query('BEGIN');
  await su.query(`SELECT set_config('scopeflow.allow_delete','on',true), set_config('scopeflow.account_delete','on',true)`);
  await su.query('DELETE FROM scopeflow.ledger_entries WHERE project_id LIKE $1', [P + '%']);
  await su.query('DELETE FROM scopeflow.versions WHERE project_id LIKE $1', [P + '%']);
  await su.query('DELETE FROM scopeflow.projects WHERE id LIKE $1', [P + '%']);
  await su.query('COMMIT');
  await su.query(`DROP ROLE ${ROLE}`);
  await su.end();
});

/** Runs statements as the app role in a transaction that is always rolled back; returns the error code or 'ok'. */
async function asApp(statements) {
  await app.query('BEGIN');
  try {
    let last;
    for (const [sql, params] of statements) last = await app.query(sql, params ?? []);
    return {code: 'ok', rows: last?.rowCount, result: last?.rows};
  } catch (e) {
    return {code: e.code, message: e.message};
  } finally {
    await app.query('ROLLBACK');
  }
}

test('the app role cannot disable, drop or bypass the immutability triggers', async () => {
  for (const sql of [
    'ALTER TABLE scopeflow.versions DISABLE TRIGGER versions_immutable',
    'ALTER TABLE scopeflow.versions DISABLE TRIGGER ALL',
    'ALTER TABLE scopeflow.ledger_entries DISABLE TRIGGER ledger_append_only',
    'DROP TRIGGER versions_immutable ON scopeflow.versions',
    'ALTER TABLE scopeflow.versions OWNER TO CURRENT_USER',
    'TRUNCATE scopeflow.ledger_entries',
    "SET session_replication_role = 'replica'",
    'CREATE OR REPLACE FUNCTION scopeflow.deletion_allowed() RETURNS boolean LANGUAGE sql AS $$ SELECT true $$',
  ]) {
    const r = await asApp([[sql]]);
    assert.equal(r.code, '42501', `${sql} -> ${r.code} ${r.message ?? ''}`);
  }
});

test('the set_config bypass no longer permits changing or deleting a decided version', async () => {
  const bypass = [`SELECT set_config('scopeflow.allow_delete','on',true), set_config('scopeflow.account_delete','on',true)`];
  const update = await asApp([bypass, ['UPDATE scopeflow.versions SET content=$1 WHERE id=$2', ['{"title":"Forged"}', P + '-v1']]]);
  assert.equal(update.code, 'P0001', JSON.stringify(update));
  const del = await asApp([bypass, ['DELETE FROM scopeflow.versions WHERE id=$1', [P + '-v1']]]);
  assert.equal(del.code, 'P0001', JSON.stringify(del));
  const draft = await asApp([bypass, ['DELETE FROM scopeflow.versions WHERE id=$1', [P + '-d1']]]);
  assert.equal(draft.code, 'P0001', 'even a pending version needs the owner-only path now');
  assert.equal((await asApp([bypass, ['DELETE FROM scopeflow.ledger_entries WHERE project_id=$1', [P]]])).code, '42501', 'no DELETE privilege on the ledger');
  assert.equal((await asApp([bypass, ['DELETE FROM scopeflow.projects WHERE id=$1', [P]]])).code, 'P0001');
  // The app role still does its normal work.
  assert.equal((await asApp([["INSERT INTO scopeflow.rate_limits (id,window_id,hits) VALUES ('ws10-roles',1,1)"]])).code, 'ok');
  assert.equal((await asApp([['SELECT id FROM scopeflow.versions WHERE project_id=$1', [P]]])).code, 'ok');
});

test('deleting a decided project through the app role is refused; the tombstone function audits every call', async () => {
  const call = async (id, owner = 'ws10-roles-owner') => { const r = await app.query('SELECT scopeflow.delete_project_tombstone($1,$2,$3) AS outcome', [id, owner, 'ws-10 test']); return r.rows[0].outcome; };
  const audit = async id => (await su.query('SELECT outcome, db_role, actor, versions_deleted FROM scopeflow.deletion_audit WHERE project_id=$1 ORDER BY at', [id])).rows;
  assert.equal(await call(P), 'refused_decided');
  assert.equal((await su.query('SELECT COUNT(*)::int AS n FROM scopeflow.versions WHERE project_id=$1', [P])).rows[0].n, 1, 'decided version kept');
  assert.equal(await call(P + '-hold'), 'refused_legal_hold');
  assert.equal(await call(P + '-draft', 'someone-else'), 'not_found', 'only the owner may delete');
  assert.equal(await call(P + '-draft'), 'deleted');
  assert.equal((await su.query('SELECT COUNT(*)::int AS n FROM scopeflow.projects WHERE id=$1', [P + '-draft'])).rows[0].n, 0);
  assert.deepEqual((await audit(P)).map(r => [r.outcome, r.db_role, r.actor]), [['refused_decided', ROLE, 'ws-10 test']]);
  assert.deepEqual((await audit(P + '-draft')).map(r => [r.outcome, r.versions_deleted]), [['not_found', 0], ['deleted', 1]]);
  assert.deepEqual((await audit(P + '-hold')).map(r => r.outcome), ['refused_legal_hold']);
  // The audit log is append-only and the app role cannot write or erase it directly.
  assert.equal((await asApp([["INSERT INTO scopeflow.deletion_audit (id,project_id,actor,db_role,outcome) VALUES ('x','y','z','w','deleted')"]])).code, '42501');
  assert.equal((await asApp([['DELETE FROM scopeflow.deletion_audit WHERE project_id=$1', [P]]])).code, '42501');
  await assert.rejects(su.query('DELETE FROM scopeflow.deletion_audit WHERE project_id=$1', [P]), /append-only/);
});
