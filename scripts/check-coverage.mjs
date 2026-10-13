#!/usr/bin/env node
// Coverage gate (owner: WS-10, L14). Blocking in CI.
//
// Reads every `@covers <ID> [<ID> ...]` tag in tests/ (comments in .mjs/.js/.ts files, fixtures and
// goldens excluded) and compares them with the item IDs in tests/coverage-matrix.json
// (IMPLEMENTATION_PLAN.md §14).
//
// Fails (exit 1) when
//   - a tag names an ID that is not in the matrix (a typo hides a gap), or
//   - an item whose primary workstream has landed (its docs/ws-XX.md exists) has no tagged test.
// Items of workstreams that have not landed yet are reported, not blocking. `--strict` (or
// COVERAGE_STRICT=1) requires every item, for the final integration.
//
// Usage: node scripts/check-coverage.mjs [--json] [--strict] [--root <dir>]
import {existsSync, readFileSync, readdirSync, statSync} from 'node:fs';
import {join, relative, resolve} from 'node:path';

const argv = process.argv.slice(2);
const rootArg = argv.indexOf('--root');
const root = rootArg >= 0 && argv[rootArg + 1] ? resolve(argv[rootArg + 1]) : new URL('..', import.meta.url).pathname;
const strict = argv.includes('--strict') || process.env.COVERAGE_STRICT === '1';
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
  for (const m of text.matchAll(/@covers[ \t]+([A-Z][A-Z0-9-]*(?:[ \t]*,?[ \t]*[A-Z][A-Z0-9-]*)*)/g)) ids.push(...m[1].split(/[ \t,]+/).filter(Boolean));
  return ids;
}

/** A workstream has landed when its docs/ws-XX.md is in the tree. */
const landed = ws => existsSync(join(root, 'docs', `${String(ws).toLowerCase()}.md`));

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
const uncovered = [...expected.values()].filter(i => !found.has(i.id)).map(i => ({id: i.id, primary: i.primary, blocking: strict || landed(i.primary)}));
const unknown = [...found.keys()].filter(id => !expected.has(id)).sort();
const blocking = uncovered.filter(i => i.blocking);
const ok = !unknown.length && !blocking.length;
const report = {
  ok, strict, expected: expected.size, covered: covered.length, uncovered, unknown,
  files: Object.fromEntries([...found].map(([id, set]) => [id, [...set].sort()])),
};

if (argv.includes('--json')) console.log(JSON.stringify(report, null, 2));
else {
  console.log(`Coverage tags: ${covered.length}/${expected.size} matrix items covered${strict ? ' (strict)' : ''}.`);
  const byWs = new Map();
  for (const i of uncovered) byWs.set(i.primary, [...(byWs.get(i.primary) ?? []), i]);
  for (const [ws, list] of [...byWs].sort()) {
    const tag = list[0].blocking ? 'BLOCKING' : 'not landed, report only';
    console.log(`  ${ws}: ${list.length} uncovered (${list.map(i => i.id).join(', ')}) [${tag}]`);
  }
  if (unknown.length) console.log(`  Tags not in the matrix (BLOCKING): ${unknown.join(', ')}`);
  console.log(ok ? 'Coverage gate passed.' : 'Coverage gate failed: tag a test `// @covers <ID>` for each blocking item, or fix the unknown tags.');
}
process.exitCode = ok ? 0 : 1;
