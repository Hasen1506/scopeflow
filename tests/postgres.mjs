import './support/ts-resolve.mjs';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { createConnection } from '../db/connection.mjs';
import { applyPostgresMigrations } from '../scripts/migrate.mjs';
import { requireLocalDatabase } from './support/local.mjs';
import { getDatabase, postgresQuery } from '../db/client.ts';
requireLocalDatabase();
const sql = createConnection();
const db = getDatabase();
let passed = 0;
try {
  assert.deepEqual(await applyPostgresMigrations(sql), []); passed++;
  const directory = mkdtempSync('/tmp/scopeflow-pg-migrations-');
  try {
    writeFileSync(directory + '/9999_failure.sql', 'CREATE TABLE scopeflow.must_rollback(id text); INVALID SQL;');
    await assert.rejects(applyPostgresMigrations(sql, directory)); passed++;
    const [table] = await sql`SELECT to_regclass('scopeflow.must_rollback') AS name`;
    assert.equal(table.name, null); passed++;
    const [journal] = await sql`SELECT COUNT(*) AS n FROM scopeflow._migrations WHERE name='9999_failure.sql'`;
    assert.equal(journal.n, 0); passed++;
  } finally { rmSync(directory, { recursive: true }); }
  assert.equal(postgresQuery("SELECT '?' FROM projects WHERE id=? AND owner=?"), "SELECT '?' FROM scopeflow.projects WHERE id=$1 AND owner=$2"); passed++;
  await assert.rejects(db.batch([
    db.prepare('INSERT INTO projects(id,owner,latest,created) VALUES (?,?,1,?)').bind('pg_rollback', 'fictional', 'now'),
    db.prepare('INSERT INTO versions(id,project_id,version,token,content,created) VALUES (?,?,1,?,?,?)').bind('pg_invalid', 'missing_project', 't', '{}', 'now'),
  ])); passed++;
  assert.equal(await db.prepare('SELECT id FROM projects WHERE id=?').bind('pg_rollback').first(), null); passed++;
  await db.prepare('DELETE FROM rate_limits WHERE id=?').bind('pg_concurrency').run();
  const attempts = await Promise.all(Array.from({ length: 20 }, () => db.prepare('INSERT INTO rate_limits(id,window_id,hits) VALUES (?,1,1) ON CONFLICT(id) DO UPDATE SET hits=rate_limits.hits+1 RETURNING hits').bind('pg_concurrency').first()));
  assert.deepEqual(attempts.map(row => row.hits).sort((a,b) => a-b), Array.from({ length: 20 }, (_,i) => i+1)); passed++;
  await db.prepare('DELETE FROM rate_limits WHERE id=?').bind('pg_concurrency').run();
  console.log(JSON.stringify({ passed, suite: 'postgres', migrationIdempotency: true, migrationRollback: true, batchRollback: true, concurrentWrites: true }));
} finally {
  await sql.end();
  const { getConnection } = await import('../db/connection.mjs');
  await getConnection().end();
}
