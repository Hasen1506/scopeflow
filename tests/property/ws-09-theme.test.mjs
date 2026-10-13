// WS-09 L9 / LT-18 / SF-21 pure checks: both themes (A Etched, B ScopeFlow original) in light and dark keep
// every token text/background pair at WCAG AA (>= 4.5:1), cross-family pairs (text on paper, text on cards and
// callouts, every rule that sets colour + background) too, field/button edges >= 3:1, nested panels distinct, theme B light (the default) is the untouched :root
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

// ---- Cross-family checks (UX-C01..C04, C08, C55) ----------------------------------------------------------------
// The pairs above are same-family. These catch the cases where a component mixes families: ink text on the
// paper, paper ink on an app surface, a status colour on a nested panel, a field or button edge on a card.
// Inside the scope document (.paper) and the landing vignette (.vc-doc, .vc-slip) the ink, accent and status tokens
// are re-pointed by the paper scope blocks, so text that lands on paper is checked with those tokens.
const PAPER_SCOPE = ['.paper,.vc-doc,.vc-slip'];
const PAPER_COMBOS = {
  'B light': [], 'B dark': [], 'A dark': [],
  'A light': [':root[data-theme="a"]:not([data-scheme="dark"]) .paper,:root[data-theme="a"]:not([data-scheme="dark"]) .vc-doc,:root[data-theme="a"]:not([data-scheme="dark"]) .vc-slip'],
};
const paperTokensFor = name => Object.assign(tokensFor(name), ...PAPER_SCOPE.map(pick), ...PAPER_COMBOS[name].map(pick));
const ratio = (t, fg, bg, page = color(t, '--bg')) => { const back = T.over(color(t, bg), page); return T.contrastRatio(T.over(color(t, fg), back), back); };
// Text on cards, nested panels and callouts in the app (text colour inherited from the card is --ink).
const CARD_TEXT = [
  ['--ink-3', '--surface-2'], ['--accent', '--surface-2'], ['--ok', '--surface-2'], ['--warn', '--surface-2'], ['--bad', '--surface-2'],
  ['--ink', '--ok-bg'], ['--ink', '--warn-bg'], ['--ink', '--bad-bg'], ['--ink-2', '--info-bg'], ['--accent', '--info-bg'],
  ['--ink-2', '--surface-3'], ['--ink', '--popover'], ['--ink-2', '--accent-soft'],
];
// Text that lands on the paper: anything inside .paper/.vc-doc/.vc-slip, whichever family it was written in.
const PAPER_TEXT = [
  ['--ink', '--paper'], ['--ink-2', '--paper'], ['--ink-3', '--paper'], ['--accent', '--paper'],
  ['--ok', '--paper'], ['--warn', '--paper'], ['--bad', '--paper'], ['--paper-ink', '--paper'], ['--paper-ink-2', '--paper'],
  ['--paper-ink', '--accent-soft'], ['--paper-ink', '--warn-bg'], ['--warn', '--warn-bg'], ['--ink', '--surface-2'],
  ['--on-accent', '--accent'],
];
for (const name of Object.keys(COMBOS)) {
  test(`${name}: cross-family text on cards, panels, callouts and the paper is WCAG AA (>= 4.5:1)`, () => {
    const t = tokensFor(name), p = paperTokensFor(name), bad = [];
    for (const [fg, bg] of CARD_TEXT) { const r = ratio(t, fg, bg); if (r < 4.5) bad.push(`card ${fg} on ${bg}: ${r.toFixed(2)}`); }
    for (const [fg, bg] of PAPER_TEXT) { const r = ratio(p, fg, bg); if (r < 4.5) bad.push(`paper ${fg} on ${bg}: ${r.toFixed(2)}`); }
    assert.deepEqual(bad, []);
  });
  test(`${name}: field and button edges are >= 3:1 against what they sit on (WCAG 1.4.11)`, () => {
    const t = tokensFor(name), bad = [];
    for (const around of ['--bg', '--surface', '--surface-2']) {
      const edge = ratio(t, '--rule-strong', around);
      if (edge < 3) bad.push(`--rule-strong on ${around}: ${edge.toFixed(2)}`);
      // A field's edge must stand off its own fill too, unless the fill alone already stands off the surround.
      const fill = T.over(color(t, '--paper'), color(t, '--bg')), aroundC = T.over(color(t, around), color(t, '--bg'));
      const onFill = T.contrastRatio(T.over(color(t, '--rule-strong'), fill), fill);
      if (onFill < 3 && T.contrastRatio(fill, aroundC) < 3) bad.push(`field on ${around}: edge ${onFill.toFixed(2)}, fill ${T.contrastRatio(fill, aroundC).toFixed(2)}`);
    }
    const p = paperTokensFor(name), onPaper = ratio(p, '--rule-strong', '--paper');
    if (onPaper < 3) bad.push(`paper --rule-strong on --paper: ${onPaper.toFixed(2)}`);
    assert.deepEqual(bad, []);
  });
  test(`${name}: cards, nested panels and callouts are visibly distinct from what they sit on`, () => {
    const t = tokensFor(name), bad = [];
    const step = (a, b) => T.contrastRatio(T.over(color(t, a), color(t, '--bg')), T.over(color(t, b), color(t, '--bg')));
    // Cards also carry a --rule border and a shadow, so the page step is a little smaller than the nesting step.
    if (step('--surface', '--bg') < 1.12) bad.push(`--surface vs --bg: ${step('--surface', '--bg').toFixed(2)}`);
    for (const inner of ['--surface-2', '--info-bg', '--ok-bg', '--warn-bg', '--bad-bg']) {
      if (step(inner, '--surface') < 1.2) bad.push(`${inner} vs --surface: ${step(inner, '--surface').toFixed(2)}`);
    }
    assert.deepEqual(bad, []);
  });
}

// Real usage: every rule in globals.css that sets both a text colour and a background from tokens, resolved per
// theme (inside the paper scope when the selector is part of the paper or the vignette).
const USAGE = blocks.flatMap(({sel, body}) => {
  const fg = body.match(/(?<![-\w])color\s*:\s*var\((--[\w-]+)\)/), bg = body.match(/(?<![-\w])background(?:-color)?\s*:\s*var\((--[\w-]+)\)/);
  return fg && bg ? [{sel, fg: fg[1], bg: bg[1]}] : [];
});
test('usage scan finds the component rules (sanity)', () => {
  for (const sel of ['body', 'input[readonly]', '.tag', '.vc-chip', '.vc-slip', '.paper']) assert.ok(USAGE.some(u => u.sel === sel), sel);
});
for (const name of Object.keys(COMBOS)) {
  test(`${name}: every globals.css rule that sets colour and background together is WCAG AA`, () => {
    const t = tokensFor(name), p = paperTokensFor(name), bad = [];
    for (const {sel, fg, bg} of USAGE) {
      const inPaper = /\.paper|\.vc-/.test(sel), tk = inPaper ? p : t;
      if (!tk[fg] || !tk[bg]) continue;
      const r = ratio(tk, fg, bg);
      if (r < 4.5) bad.push(`${sel}: ${fg} on ${bg} ${r.toFixed(2)}`);
    }
    // The vignette seal draws --seal on a 6% tint of the paper.
    const seal = color(p, '--ok'), paper = color(p, '--paper');
    const tint = T.over([...seal.slice(0, 3), 0.06], paper);
    if (T.contrastRatio(seal, tint) < 4.5) bad.push(`.vc-seal: ${T.contrastRatio(seal, tint).toFixed(2)}`);
    assert.deepEqual(bad, []);
  });
}

test('owner brand colour: readableOn keeps a passing colour and derives a same-hue shade that reaches the target', () => {
  assert.equal(T.readableOn('#1A2452', '#F4EEE1'), '#1a2452', 'already readable: unchanged');
  for (const bg of ['#F4EEE1', '#11152A', '#1F3FA8', '#0F1D55']) {
    for (const c of ['#FFD400', '#1f6feb', '#0A0A40', '#FFFFFF', '#000000', '#E91E63', '#7FFFD4']) {
      for (const min of [4.5, 3]) {
        const out = T.readableOn(c, bg, min);
        assert.ok(T.contrastRatio(T.parseColor(out), T.parseColor(bg)) >= min, `${c} on ${bg} >= ${min}: got ${out}`);
      }
    }
  }
  assert.equal(T.readableOn('blue', '#FFFFFF'), null);
  assert.equal(T.readableOn('#123456', null), null);
});

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
