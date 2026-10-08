// Type scale guard (pure, no server). The app uses one strict scale (see the TYPE SCALE block in app/globals.css
// and NOTES.md): six size steps --fs-1..6 with line heights --lh-1..6, weights --fw-1..3 (+ the --fw-ui role),
// and at most two families per theme (--font-display, --font-ui). Outside the token blocks, no raw font-size,
// font-family, font-weight or line-height value may appear in any stylesheet, and no component may set fonts inline
// or with arbitrary Tailwind sizes. Equivalent grep: see NOTES.md "Type scale".
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, readdirSync, statSync} from 'node:fs';
import {join, relative} from 'node:path';

const root = new URL('../../', import.meta.url).pathname;
function walk(dir, re, out = []) {
  for (const name of readdirSync(join(root, dir))) {
    const p = join(dir, name);
    if (name === 'node_modules' || name.startsWith('.')) continue;
    if (statSync(join(root, p)).isDirectory()) walk(p, re, out);
    else if (re.test(name)) out.push(p);
  }
  return out;
}
const css = readFileSync(join(root, 'app/globals.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
// Token blocks: the theme definitions and Tailwind's @theme mapping. Everything else is "usage".
const TOKEN_BLOCK = /(^|\n)\s*(:root|:root,\[data-theme="b"\]|\[data-theme="a"\]|@theme inline)\s*\{[^{}]*\}/g;
const tokens = css.match(TOKEN_BLOCK) ?? [];
const usage = css.replace(TOKEN_BLOCK, '\n');
const decls = (text, prop) => [...text.matchAll(new RegExp(`(?<![-\\w])${prop}\\s*:\\s*([^;}]+)`, 'g'))].map(m => m[1].replace(/!important/, '').trim());

test('token blocks: six sizes, six line heights, three weights, two families per theme', () => {
  assert.equal(tokens.length, 4, 'expected :root, theme B, theme A and @theme inline blocks');
  const [base, b, a] = tokens;
  for (const n of [1, 2, 3, 4, 5, 6]) {
    assert.match(base, new RegExp(`--fs-${n}:`), `--fs-${n} defined`);
    assert.match(base, new RegExp(`--lh-${n}:`), `--lh-${n} defined`);
  }
  assert.doesNotMatch(base, /--fs-7|--lh-7|--fw-4/, 'no extra steps');
  for (const n of [1, 2, 3]) assert.match(base, new RegExp(`--fw-${n}:`));
  for (const [name, block] of [['B', b], ['A', a]]) {
    const fams = new Set([...block.matchAll(/--font-(display|ui):\s*var\((--font-[a-z]+)\)/g)].map(m => m[2]));
    assert.ok(fams.size >= 1 && fams.size <= 2, `theme ${name} uses ${fams.size} families`);
    assert.match(block, /--fw-ui:/, `theme ${name} sets the UI weight role`);
  }
});

test('globals.css: every font size, family, weight and line height outside the tokens is a token', () => {
  const bad = [];
  for (const v of decls(usage, 'font-size')) if (!/^(var\(--fs-[1-6]\)|inherit)$/.test(v)) bad.push('font-size:' + v);
  for (const v of decls(usage, 'font-family')) if (!/^(var\(--font-(display|ui)\)|inherit)$/.test(v)) bad.push('font-family:' + v);
  for (const v of decls(usage, 'font-weight')) if (!/^(var\(--fw-([1-3]|ui)\)|inherit)$/.test(v)) bad.push('font-weight:' + v);
  for (const v of decls(usage, 'line-height')) if (!/^(var\(--lh-[1-6]\)|inherit)$/.test(v)) bad.push('line-height:' + v);
  for (const v of decls(usage, 'font')) if (v !== 'inherit') bad.push('font:' + v);
  assert.deepEqual(bad, []);
});

test('no other stylesheet sets fonts', () => {
  const sheets = [...walk('app', /\.css$/), ...walk('components', /\.css$/), ...walk('vendor', /\.css$/)].filter(f => f !== 'app/globals.css');
  const bad = sheets.flatMap(f => { const t = readFileSync(join(root, f), 'utf8'); return ['font-size', 'font-family', 'font-weight', 'line-height'].flatMap(p => decls(t, p).filter(v => !/^var\(--/.test(v)).map(v => `${f}: ${p}:${v}`)); });
  assert.deepEqual(bad, []);
});

test('components: no inline font styles and no arbitrary Tailwind type sizes', () => {
  const files = [...walk('app', /\.(tsx|ts)$/), ...walk('components', /\.(tsx|ts)$/)];
  const bad = [];
  for (const f of files) {
    const t = readFileSync(join(root, f), 'utf8');
    for (const m of t.matchAll(/style=\{\{[^}]*\b(fontSize|fontFamily|fontWeight|lineHeight|font)\s*:/g)) bad.push(`${relative(root, join(root, f))}: inline ${m[1]}`);
    for (const m of t.matchAll(/\b(text|leading)-\[[\d.]+(px|rem|em)?\]|\bfont-\[[^\]]+\]/g)) bad.push(`${f}: ${m[0]}`);
  }
  assert.deepEqual(bad, []);
});
