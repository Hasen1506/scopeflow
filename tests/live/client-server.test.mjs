// Differential, end to end: the review page's in-browser check (lib/record-check.ts, run
// here on exactly what GET /api/review/:token returns) against the server's own
// verification (GET /api/scopes/:id/ledger: chain + signature seal), after random
// tampering applied directly in the database with the immutability triggers disabled.
import {test, before, after} from 'node:test';
import assert from 'node:assert/strict';
import {fc} from '../support/property.mjs';
import {call, database, owner, project, changeOrder} from './support.mjs';

const {checkClientRecord} = await import('../../lib/record-check.ts');
let db, A, P, original;
before(async () => {
  db = await database();
  A = await owner('prop-diff-owner');
  await db.query('DELETE FROM scopeflow.rate_limits');
  P = await project(A, 'Differential baseline', {approve: true});
  const seq = await changeOrder(A, P.project_id, 400);
  assert.equal((await call(`/api/review/${P.token}/change-order`, {method: 'POST', body: {seq, decision: 'approved', signer: 'Fictional Client', comment: ''}})).status, 200);
  await changeOrder(A, P.project_id, 250, 'Pending extra');
  for (const body of [{kind: 'goodwill', baseline_version: 1, payload: {title: 'Hidden favour', value: 80, visible: false}}, {kind: 'revision_round', baseline_version: 1, payload: {feedback_date: '2026-10-08', note: 'Colour'}}]) {
    assert.equal((await call(`/api/scopes/${P.project_id}/ledger`, {method: 'POST', cookie: A.cookie, body})).status, 201);
  }
  original = {
    version: (await db.query('SELECT content,signer,decided,signature FROM scopeflow.versions WHERE project_id=$1 AND version=1', [P.project_id])).rows[0],
    entries: (await db.query('SELECT * FROM scopeflow.ledger_entries WHERE project_id=$1 ORDER BY seq', [P.project_id])).rows,
  };
});
after(async () => { await restore(); await db.end(); });

/** Runs SQL as a database administrator would: triggers off (superuser-only). */
async function asAdmin(fn) {
  await db.query('BEGIN');
  await db.query("SET LOCAL session_replication_role = 'replica'");
  try { await fn(); await db.query('COMMIT'); } catch (e) { await db.query('ROLLBACK'); throw e; }
}
async function restore() {
  await asAdmin(async () => {
    const v = original.version;
    await db.query('UPDATE scopeflow.versions SET content=$1,signer=$2,decided=$3,signature=$4 WHERE project_id=$5 AND version=1', [v.content, v.signer, v.decided, v.signature, P.project_id]);
    await db.query('DELETE FROM scopeflow.ledger_entries WHERE project_id=$1', [P.project_id]);
    for (const e of original.entries) {
      const cols = Object.keys(e);
      await db.query(`INSERT INTO scopeflow.ledger_entries (${cols.join(',')}) VALUES (${cols.map((_, n) => '$' + (n + 1)).join(',')})`, cols.map(c => e[c]));
    }
  });
}
const tampers = {
  none: async () => {},
  'scope content': async () => db.query(`UPDATE scopeflow.versions SET content=replace(content,'"fee":1500','"fee":15000') WHERE project_id=$1 AND version=1`, [P.project_id]),
  signer: async () => db.query(`UPDATE scopeflow.versions SET signer='Someone Else' WHERE project_id=$1 AND version=1`, [P.project_id]),
  'decided time': async () => db.query(`UPDATE scopeflow.versions SET decided='2020-01-01T00:00:00.000Z' WHERE project_id=$1 AND version=1`, [P.project_id]),
  'anchor signature': async () => db.query(`UPDATE scopeflow.versions SET signature=split_part(signature,'.',1)||'.AAAA' WHERE project_id=$1 AND version=1`, [P.project_id]),
  'change order fee': async () => db.query(`UPDATE scopeflow.ledger_entries SET payload=replace(payload,'"fee_delta":400','"fee_delta":4000') WHERE project_id=$1 AND seq=1`, [P.project_id]),
  'settle outcome': async () => db.query(`UPDATE scopeflow.ledger_entries SET payload=replace(payload,'approved','declined') WHERE project_id=$1 AND kind='settle'`, [P.project_id]),
  'hidden goodwill value': async () => db.query(`UPDATE scopeflow.ledger_entries SET payload=replace(payload,'"value":80','"value":8') WHERE project_id=$1 AND kind='goodwill'`, [P.project_id]),
  'entry time': async () => db.query(`UPDATE scopeflow.ledger_entries SET created='2020-01-01T00:00:00.000Z' WHERE project_id=$1 AND seq=2`, [P.project_id]),
  'delete middle entry': async () => db.query(`DELETE FROM scopeflow.ledger_entries WHERE project_id=$1 AND seq=2`, [P.project_id]),
  'delete last entry': async () => db.query(`DELETE FROM scopeflow.ledger_entries WHERE project_id=$1 AND seq=(SELECT max(seq) FROM scopeflow.ledger_entries WHERE project_id=$1)`, [P.project_id]),
  'entry signature': async () => db.query(`UPDATE scopeflow.ledger_entries SET signature=split_part(signature,'.',1)||'.AAAA' WHERE project_id=$1 AND seq=3`, [P.project_id]),
  'strip all signatures': async () => { await db.query('UPDATE scopeflow.ledger_entries SET signature=NULL WHERE project_id=$1', [P.project_id]); await db.query('UPDATE scopeflow.versions SET signature=NULL WHERE project_id=$1', [P.project_id]); },
};

test('the in-browser check and server verification agree on every tampering', async t => {
  const tally = {};
  await fc.assert(fc.asyncProperty(fc.constantFrom(...Object.keys(tampers)), async name => {
    await restore();
    await asAdmin(tampers[name]);
    await db.query('DELETE FROM scopeflow.rate_limits');
    const server = (await call(`/api/scopes/${P.project_id}/ledger`, {cookie: A.cookie})).json;
    const review = (await call(`/api/review/${P.token}`)).json;
    const serverOk = server.chain.intact && server.seal.state !== 'invalid';
    assert.ok(review.ledger, 'review page receives the ledger');
    const client = await checkClientRecord(review.scope, review.ledger);
    tally[name] = `server=${serverOk ? 'ok' : 'fail'}(${server.seal.state}) client=${client.state}`;
    assert.equal(client.state === 'ok', serverOk, `${name}: ${tally[name]} ${client.detail ?? ''}`);
    if (name === 'none') assert.equal(client.state === 'ok' && client.signed, true);
    if (name === 'strip all signatures') assert.ok(client.state === 'ok' && !client.signed, 'documented: stripped signatures read as legacy unsigned');
    if (!['none', 'delete last entry', 'strip all signatures'].includes(name)) assert.equal(client.state, 'failed', name + ' must be detected');
  }), {numRuns: Number(process.env.DIFF_RUNS ?? 40)});
  t.diagnostic(JSON.stringify(tally));
});
