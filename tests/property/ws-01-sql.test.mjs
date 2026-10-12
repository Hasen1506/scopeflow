// WS-01 (M25): the SQL adapter's placeholder rewrite is a tokenizer, and data-modifying CTEs take
// the write/lock path. Pure: a spy connection stands in for PostgreSQL.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fc} from '../support/property.mjs';

const C = await import('../../db/client.ts');

// @covers M25
test('M25 unit: placeholders in strings, identifiers, comments and dollar quotes are untouched; JSONB ? operators kept', () => {
  const q = C.postgresQuery;
  assert.equal(q('SELECT * FROM projects WHERE id=? AND owner=?'), 'SELECT * FROM scopeflow.projects WHERE id=$1 AND owner=$2');
  assert.equal(q("SELECT 'what?' AS a, ? AS b"), "SELECT 'what?' AS a, $1 AS b");
  assert.equal(q("SELECT 'it''s ?' , ?"), "SELECT 'it''s ?' , $1");
  assert.equal(q("SELECT E'a\\'?' , ?"), "SELECT E'a\\'?' , $1", 'E-string with a backslash-escaped quote');
  assert.equal(q('SELECT "col?" FROM "projects" WHERE x=?'), 'SELECT "col?" FROM "projects" WHERE x=$1');
  assert.equal(q('SELECT ? -- why?\n, ?'), 'SELECT $1 -- why?\n, $2');
  assert.equal(q('SELECT /* a ? /* nested ? */ still ? */ ?'), 'SELECT /* a ? /* nested ? */ still ? */ $1');
  assert.equal(q('SELECT $$ ? $$, $tag$ ?\n $$ ? $tag$, ?'), 'SELECT $$ ? $$, $tag$ ?\n $$ ? $tag$, $1');
  assert.equal(q("SELECT content::jsonb ?? 'fx' FROM versions WHERE id=?"), "SELECT content::jsonb ? 'fx' FROM scopeflow.versions WHERE id=$1");
  assert.equal(q("SELECT content::jsonb ?| array['a','b'], content::jsonb ?& array['c'] FROM versions WHERE id=?"), "SELECT content::jsonb ?| array['a','b'], content::jsonb ?& array['c'] FROM scopeflow.versions WHERE id=$1");
  assert.equal(q('SELECT ?||?'), 'SELECT $1||$2', 'concatenation of two parameters is not ?|');
  assert.equal(q("SELECT 'FROM projects' , x FROM projects"), "SELECT 'FROM projects' , x FROM scopeflow.projects", 'table names inside literals are not rewritten');
  assert.equal(q('SELECT $1::text'), 'SELECT $1::text', 'existing $n stays');
  // The 5e59e44 regex numbered the ? inside a comment and a dollar quote.
});

// @covers M25
test('M25 property: the number of $n equals the number of ? outside literals and comments', () => {
  const piece = fc.constantFrom('?', "'?'", "'a''?'", '"?"', '-- ?\n', '/* ? */', '$$?$$', ' x ', '??', '?| ', ', ', 'projects');
  fc.assert(fc.property(fc.array(piece, {maxLength: 30}), parts => {
    const sql = 'SELECT ' + parts.join(' ');
    const expected = parts.filter(p => p === '?').length;
    const out = C.postgresQuery(sql);
    const found = [...out.matchAll(/\$(\d+)/g)].map(m => Number(m[1]));
    assert.deepEqual(found, Array.from({length: expected}, (_, i) => i + 1), sql);
  }), {numRuns: 500});
});

// @covers M25
test('M25 regression: the invoice-numbering CTE is a mutation and takes the lock path (spy)', async () => {
  const cte = `WITH n AS (UPDATE business_profiles SET next_invoice=next_invoice+1 WHERE owner=? AND next_invoice=? RETURNING next_invoice-1 AS seq)
      INSERT INTO invoices (id,owner,seq) SELECT ?,?,n.seq FROM n RETURNING id,seq`;
  assert.equal(C.isMutation(cte), true);
  assert.equal(C.isMutation('WITH a AS (SELECT 1) SELECT * FROM a'), false);
  assert.equal(C.isMutation("SELECT 'DELETE' AS word"), false);
  assert.equal(C.isMutation('/* note */ DELETE FROM drafts WHERE owner=?'), true);
  assert.equal(C.isMutation('SELECT id FROM projects WHERE id=? FOR UPDATE'), true, 'a locking read needs a read-write transaction');
  const calls = [];
  const spy = {
    async unsafe(query, values = []) { calls.push(['unsafe', query, values]); return Object.assign([{id: 'inv', seq: 7}], {count: 1}); },
    async begin(cb, mode) { calls.push(['begin', mode]); return cb(spy); },
  };
  const statement = C.getDatabase().prepare(cte).bind('owner-1', 7, 'id-1', 'owner-1').lock(C.lockKey('owner', 'owner-1'));
  const r = await statement.allOn(spy);
  assert.deepEqual(r.results, [{id: 'inv', seq: 7}]);
  assert.deepEqual(calls.map(c => c[0]), ['begin', 'unsafe', 'unsafe']);
  assert.equal(calls[0][1], undefined, 'read-write transaction');
  assert.match(calls[1][1], /pg_advisory_xact_lock/); assert.deepEqual(calls[1][2], ['scopeflow:owner:owner-1']);
  assert.match(calls[2][1], /UPDATE scopeflow\.business_profiles .* INSERT INTO scopeflow\.invoices/s);
  assert.match(calls[2][1], /owner=\$1 AND next_invoice=\$2/);
});
