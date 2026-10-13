// WS-09 L9 / LT-18 / SF-21 pure checks: both themes (A Etched, B ScopeFlow original) in light and dark keep
// every token text/background pair at WCAG AA (>= 4.5:1), theme B light (the default) is the untouched :root
// block, the theme blocks only re-point tokens (no fonts), and the theme preference parses strictly.
// Reads app/globals.css; no browser, no network.
// @covers L9 LT-18 SF-21
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const T = await import('../../lib/theme.ts');
const css = readFileSync(new URL('../../app/globals.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const blocks = [...css.matchAll(/(^|\n)\s*([^{}\n@][^{}]*?)\s*\{([^{}]*)\}/g)].map(m => ({sel: m[2].trim(), body: m[3]}));
const props = body => Object.fromEntries([...body.matchAll(/(--[\w-]+)\s*:\s*([^;]+)/g)].map(m => [m[1], m[2].trim()]));
const pick = sel => { const b = blocks.filter(x => x.sel === sel); assert.ok(b.length, 'block ' + sel); return Object.assign({}, ...b.map(x => props(x.body))); };
const BASE = pick(':root');
const COMBOS = {
  'B light': [],
  'B dark': [':root[data-scheme="dark"]'],
  'A light': [':root[data-theme="a"]'],
  'A dark': [':root[data-theme="a"]', ':root[data-scheme="dark"]', ':root[data-theme="a"][data-scheme="dark"]'],
};
const tokensFor = name => Object.assign({}, BASE, ...COMBOS[name].map(pick));
function color(tokens, name, seen = new Set()) {
  const v = tokens[name];
  assert.ok(v, `${name} defined`);
  const ref = v.match(/^var\((--[\w-]+)\)$/);
  if (ref) { assert.ok(!seen.has(ref[1]), 'no var cycle'); seen.add(ref[1]); return color(tokens, ref[1], seen); }
  const c = T.parseColor(v);
  assert.ok(c, `${name}: ${v} is a colour`);
  return c;
}
// [text, background] token pairs that components actually render. Translucent backgrounds sit on --bg.
const PAIRS = [
  ['--ink', '--bg'], ['--ink-2', '--bg'], ['--ink-3', '--bg'],
  ['--ink', '--surface'], ['--ink-2', '--surface'], ['--ink-3', '--surface'],
  ['--ink', '--surface-2'], ['--ink-2', '--surface-2'],
  ['--accent', '--bg'], ['--accent', '--surface'], ['--accent', '--accent-soft'], ['--ink', '--accent-soft'],
  ['--on-accent', '--accent'], ['--on-accent', '--accent-hover'],
  ['--paper-ink', '--paper'], ['--paper-ink-2', '--paper'], ['--paper-accent', '--paper'],
  ['--ok', '--ok-bg'], ['--warn', '--warn-bg'], ['--bad', '--bad-bg'], ['--ink', '--info-bg'],
  ['--ok', '--surface'], ['--warn', '--surface'], ['--bad', '--surface'],
  ['--surface', '--bad'], ['--on-band', '--band'], ['--on-band-2', '--band'],
  ['--foreground', '--background'], ['--card-foreground', '--card'], ['--muted-foreground', '--muted'], ['--primary-foreground', '--primary'],
];

for (const name of Object.keys(COMBOS)) {
  test(`${name}: every token text/background pair is WCAG AA (>= 4.5:1)`, () => {
    const t = tokensFor(name);
    const page = color(t, '--bg');
    assert.equal(page[3], 1, '--bg is opaque');
    const bad = [];
    for (const [fg, bg] of PAIRS) {
      const back = T.over(color(t, bg), page);
      const ratio = T.contrastRatio(T.over(color(t, fg), back), back);
      if (ratio < 4.5) bad.push(`${fg} on ${bg}: ${ratio.toFixed(2)}`);
    }
    assert.deepEqual(bad, []);
  });
}

test('contrast maths matches WCAG reference values', () => {
  assert.equal(T.contrastRatio(T.parseColor('#000'), T.parseColor('#fff')).toFixed(1), '21.0');
  assert.equal(T.contrastRatio(T.parseColor('#777'), T.parseColor('#fff')).toFixed(2), '4.48');
  assert.deepEqual(T.over(T.parseColor('rgba(255,255,255,.5)'), T.parseColor('#000000')), [127.5, 127.5, 127.5, 1]);
});

test('theme blocks re-point colour/shape tokens only: no fonts, and the default :root block keeps theme B light', () => {
  for (const sel of new Set(Object.values(COMBOS).flat())) {
    const b = blocks.filter(x => x.sel === sel).map(x => x.body).join(';');
    assert.doesNotMatch(b, /(^|[;\s])(font|font-size|font-family|font-weight|line-height)\s*:/, sel);
    assert.doesNotMatch(b, /--(font|fs|lh|fw)-/, sel + ' keeps the shared type scale');
  }
  assert.equal(BASE['--bg'], '#F4EEE1');
  assert.equal(BASE['--ink'], '#1A2452');
  assert.equal(BASE['--accent'], '#1F3FA8');
});

test('theme preference: strict on write, forgiving on read; client pages follow the system', () => {
  assert.deepEqual(T.validChoice({theme: 'a', mode: 'dark'}), {theme: 'a', mode: 'dark'});
  for (const bad of [null, {}, {theme: 'c', mode: 'dark'}, {theme: 'a', mode: 'dim'}, {theme: 'a'}]) assert.equal(T.validChoice(bad), null);
  assert.deepEqual(T.parseChoice({theme: 'x', mode: 1}), T.DEFAULT_CHOICE);
  assert.deepEqual(T.parseChoice(null), {theme: 'b', mode: 'system'});
  assert.equal(T.resolveScheme('system', true), 'dark');
  assert.equal(T.resolveScheme('system', false), 'light');
  assert.equal(T.resolveScheme('light', true), 'light');
  assert.equal(T.resolveScheme('dark', false), 'dark');
  assert.ok(T.isClientPath('/review/' + 'a'.repeat(64)));
  assert.ok(!T.isClientPath('/templates'));
  assert.match(T.themeScript, /prefers-color-scheme: dark/);
  assert.match(T.themeScript, /\^\\\/review\\\//, 'script forces the system scheme on client pages');
});
