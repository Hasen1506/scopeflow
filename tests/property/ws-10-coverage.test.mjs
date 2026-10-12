// L14: scripts/check-coverage.mjs is a blocking gate. Every C/H/M/L (and LT/SF/OP/QA) id in the
// matrix needs a test tagged `@covers <ID>`; CI fails otherwise. Runs the script on throwaway trees.
// @covers L14
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync, mkdirSync, writeFileSync, readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const script = new URL('../../scripts/check-coverage.mjs', import.meta.url).pathname;
function tree({items, tests, docs = []}) {
  const root = mkdtempSync(join(tmpdir(), 'sf-coverage-'));
  mkdirSync(join(root, 'tests', 'fixtures'), {recursive: true}); mkdirSync(join(root, 'docs'));
  writeFileSync(join(root, 'tests', 'coverage-matrix.json'), JSON.stringify({items}));
  for (const [name, text] of Object.entries(tests)) writeFileSync(join(root, 'tests', name), text);
  for (const d of docs) writeFileSync(join(root, 'docs', d), '# landed');
  return root;
}
const run = (root, ...flags) => { const r = spawnSync(process.execPath, [script, '--root', root, '--json', ...flags], {encoding: 'utf8'}); return {code: r.status, report: JSON.parse(r.stdout)}; };
// Built at run time so these sample tags never count as tags of this repository.
const TAG = '@' + 'covers';
const items = [{id: 'C1', primary: 'WS-02'}, {id: 'H3', primary: 'WS-10'}, {id: 'SF-26', primary: 'WS-10'}];

test('fails when a landed workstream has an untagged item', () => {
  const root = tree({items, tests: {'a.mjs': `// ${TAG} H3\n`}, docs: ['ws-10.md']});
  const {code, report} = run(root);
  assert.equal(code, 1);
  assert.deepEqual(report.uncovered.filter(i => i.blocking).map(i => i.id), ['SF-26']);
});

test('passes when every landed item is tagged; items of workstreams not landed are reported only', () => {
  const root = tree({items, tests: {'a.mjs': `// ${TAG} H3, SF-26\n`, 'fixtures/x.mjs': `// ${TAG} C1 (fixtures do not count)\n`}, docs: ['ws-10.md']});
  const {code, report} = run(root);
  assert.equal(code, 0);
  assert.deepEqual(report.uncovered, [{id: 'C1', primary: 'WS-02', blocking: false}]);
  assert.equal(run(root, '--strict').code, 1, '--strict requires every item');
});

test('a tag naming an unknown id fails (typos hide gaps)', () => {
  const root = tree({items, tests: {'a.mjs': `// ${TAG} H3 SF-26 H99\n`}, docs: []});
  const {code, report} = run(root);
  assert.equal(code, 1);
  assert.deepEqual(report.unknown, ['H99']);
});

test('CI runs the gate, and this repository passes it', () => {
  assert.match(readFileSync(new URL('../../.github/workflows/ci.yml', import.meta.url), 'utf8'), /node scripts\/check-coverage\.mjs/);
  const r = spawnSync(process.execPath, [script], {encoding: 'utf8'});
  assert.equal(r.status, 0, r.stdout + r.stderr);
});
