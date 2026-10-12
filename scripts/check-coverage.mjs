#!/usr/bin/env node
// Coverage-tag report (owner: WS-10). Phase 0 skeleton: report-only, always exits 0.
//
// Reads every `@covers <ID> [<ID> ...]` tag in tests/ (comments in .mjs/.js/.ts files) and
// compares them with the item IDs in tests/coverage-matrix.json (IMPLEMENTATION_PLAN.md §14).
// Usage: node scripts/check-coverage.mjs [--json]
// WS-10 makes it blocking (non-zero exit on uncovered or unknown IDs) and wires it into CI.
import {readFileSync, readdirSync, statSync} from 'node:fs';
import {join, relative} from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const testsDir = join(root, 'tests');
const skip = new Set(['node_modules', 'fixtures', '__golden__']);

function* files(dir) {
  for (const name of readdirSync(dir)) {
    if (skip.has(name)) continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) yield* files(path);
    else if (/\.(mjs|js|ts)$/.test(name)) yield path;
  }
}

/** Every ID named by an @covers tag (one line: IDs separated by spaces or commas). IDs look like C1, H13, M25, SF-05, LT-01. */
function collectTags(text) {
  const ids = [];
  for (const m of text.matchAll(/@covers[ \t]+([A-Z][A-Z0-9-]*(?:[ \t,]+[A-Z][A-Z0-9-]*)*)/g)) ids.push(...m[1].split(/[ \t,]+/).filter(Boolean));
  return ids;
}

const matrix = JSON.parse(readFileSync(join(testsDir, 'coverage-matrix.json'), 'utf8')).items;
const expected = new Map(matrix.map(i => [i.id, i]));
const found = new Map();
for (const path of files(testsDir)) {
  for (const id of collectTags(readFileSync(path, 'utf8'))) {
    if (!found.has(id)) found.set(id, new Set());
    found.get(id).add(relative(root, path));
  }
}
const covered = [...expected.keys()].filter(id => found.has(id));
const uncovered = [...expected.values()].filter(i => !found.has(i.id));
const unknown = [...found.keys()].filter(id => !expected.has(id)).sort();
const report = {
  expected: expected.size, covered: covered.length, uncovered: uncovered.map(i => ({id: i.id, primary: i.primary})), unknown,
  files: Object.fromEntries([...found].map(([id, set]) => [id, [...set].sort()])),
};

if (process.argv.includes('--json')) console.log(JSON.stringify(report, null, 2));
else {
  console.log(`Coverage tags: ${covered.length}/${expected.size} matrix items covered (report-only).`);
  const byWs = new Map();
  for (const i of uncovered) byWs.set(i.primary, [...(byWs.get(i.primary) ?? []), i.id]);
  for (const [ws, ids] of [...byWs].sort()) console.log(`  ${ws}: ${ids.length} uncovered (${ids.join(', ')})`);
  if (unknown.length) console.log(`  Tags not in the matrix: ${unknown.join(', ')}`);
}
