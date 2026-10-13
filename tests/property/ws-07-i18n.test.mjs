// WS-07 SF-09: client-page message catalogs and language selection. Pure: no server, no network,
// frozen clock, seeded properties.
// @covers SF-09
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fc, freezeClock} from '../support/property.mjs';

freezeClock();
const I = await import('../../lib/i18n/core.ts');
const read = lang => JSON.parse(readFileSync(new URL(`../../messages/${lang}.json`, import.meta.url), 'utf8'));
const catalogs = {en: read('en'), hi: read('hi'), ta: read('ta')};

// @covers SF-09
test('catalog key parity: en, hi and ta carry exactly the same keys and the same placeholders', () => {
  const keys = Object.keys(catalogs.en).sort();
  assert.ok(keys.length > 150, 'the English catalog covers the client page chrome');
  for (const lang of ['hi', 'ta']) {
    assert.deepEqual(Object.keys(catalogs[lang]).sort(), keys, `${lang} keys match en`);
    for (const k of keys) {
      assert.equal(typeof catalogs[lang][k], 'string', `${lang}.${k} is a string`);
      assert.ok(catalogs[lang][k].trim().length > 0, `${lang}.${k} is not empty`);
      assert.deepEqual(I.placeholders(catalogs[lang][k]), I.placeholders(catalogs.en[k]), `${lang}.${k} placeholders match en`);
    }
  }
});

// @covers SF-09
test('hi and ta are real translations in their own scripts (not English copies)', () => {
  const devanagari = /[\u0900-\u097F]/, tamil = /[\u0B80-\u0BFF]/;
  const keys = Object.keys(catalogs.en).filter(k => /[A-Za-z]{4}/.test(catalogs.en[k].replace(/\{\w+\}|Scopeflow|PDF|CO-|IP|QR|UTR/g, '')));
  for (const k of keys) {
    assert.match(catalogs.hi[k], devanagari, `hi.${k} is in Devanagari`);
    assert.match(catalogs.ta[k], tamil, `ta.${k} is in Tamil script`);
  }
  assert.equal(catalogs.ta['lang.name'], 'தமிழ்');
  assert.equal(catalogs.hi['lang.name'], 'हिन्दी');
});

// @covers SF-09
test('client-page sources use only keys that exist in the catalog', () => {
  const files = ['app/review/[token]/review.tsx', 'app/review/[token]/agreement.tsx', 'app/review/[token]/closed.tsx', 'app/review/[token]/link-problem.tsx', 'app/review/[token]/scope-document.tsx', 'app/scope-diff.tsx', 'app/components/slots/data-notice.tsx', 'app/components/slots/language-picker.tsx'];
  const used = new Set();
  for (const f of files) {
    const src = readFileSync(new URL('../../' + f, import.meta.url), 'utf8');
    for (const m of src.matchAll(/\bt\(\s*'([a-zA-Z]+\.[a-zA-Z.]+)'/g)) used.add(m[1]);
    for (const m of src.matchAll(/\?\s*'([a-zA-Z]+\.[a-zA-Z.]+)'\s*:\s*'([a-zA-Z]+\.[a-zA-Z.]+)'/g)) { used.add(m[1]); used.add(m[2]); }
  }
  for (const k of used) assert.ok(Object.hasOwn(catalogs.en, k), `${k} is in messages/en.json`);
  assert.ok(used.size > 100, 'the scan found the keys');
  // Status labels are looked up dynamically ('status.' + status).
  for (const s of ['pending', 'approved', 'changes_requested', 'proposed', 'declined', 'withdrawn']) assert.ok(Object.hasOwn(catalogs.en, 'status.' + s), s);
});

// @covers SF-09
test('Accept-Language: the first supported language by weight, region tags reduced to the language', () => {
  assert.equal(I.parseAcceptLanguage('ta-IN,ta;q=0.9,en-US;q=0.8,en;q=0.7'), 'ta');
  assert.equal(I.parseAcceptLanguage('fr-FR,hi;q=0.8,en;q=0.5'), 'hi');
  assert.equal(I.parseAcceptLanguage('en;q=0.2, ta;q=0.9'), 'ta');
  assert.equal(I.parseAcceptLanguage('de-DE,fr'), null);
  assert.equal(I.parseAcceptLanguage('ta;q=0'), null);
  assert.equal(I.parseAcceptLanguage(''), null);
  assert.equal(I.parseAcceptLanguage(null), null);
});

// @covers SF-09
test('pickLang precedence: ?lang > saved choice > scope language > Accept-Language > English', () => {
  assert.equal(I.pickLang({query: 'ta', stored: 'hi', scope: 'en', accept: 'hi'}), 'ta');
  assert.equal(I.pickLang({query: 'xx', stored: 'hi', scope: 'ta', accept: 'ta'}), 'hi');
  assert.equal(I.pickLang({stored: 'zz', scope: 'ta', accept: 'hi'}), 'ta');
  assert.equal(I.pickLang({accept: 'hi-IN,en;q=0.5'}), 'hi');
  assert.equal(I.pickLang({}), 'en');
  const any = fc.oneof(fc.constantFrom('en', 'hi', 'ta'), fc.string({maxLength: 4}), fc.constant(undefined), fc.constant(null));
  fc.assert(fc.property(any, any, any, fc.option(fc.string({maxLength: 30}), {nil: null}), (query, stored, scope, accept) => {
    const lang = I.pickLang({query, stored, scope, accept});
    assert.ok(I.isLang(lang));
    if (I.isLang(query)) assert.equal(lang, query);
  }));
});

// @covers SF-09
test('translator: interpolates, falls back to English for a missing key, never throws', () => {
  const t = I.makeTranslator({en: {a: 'Hello {name}', b: 'only en'}, hi: {a: 'नमस्ते {name}'}, ta: {}}, 'hi');
  assert.equal(t('a', {name: 'Ada'}), 'नमस्ते Ada');
  assert.equal(t('b'), 'only en');
  assert.equal(t('missing.key'), 'missing.key');
  fc.assert(fc.property(fc.string({maxLength: 40}), fc.dictionary(fc.stringMatching(/^\w{1,6}$/), fc.oneof(fc.string({maxLength: 10}), fc.integer())), (template, vars) => {
    const out = I.interpolate(template, vars);
    assert.equal(typeof out, 'string');
    for (const [k, v] of Object.entries(vars)) if (template === `{${k}}`) assert.equal(out, String(v));
  }));
});
