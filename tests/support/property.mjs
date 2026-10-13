// Shared setup for the property-based and differential suites (node:test + fast-check).
//
// Deterministic by construction:
//   * fast-check runs from a fixed seed (FC_SEED, default 20261007). A failure prints the
//     seed and the shrunk counterexample; rerun with FC_SEED=<seed> to reproduce.
//   * The clock is frozen (FROZEN_NOW) wherever code reads Date: every timestamp these
//     suites produce is derived from it, never from the wall clock.
//   * Signing uses a fixed test secret, so Ed25519 signatures are byte-for-byte stable.
//   * No network: pure suites import lib/* only; live suites talk to localhost only.
import './ts-resolve.mjs';
import {fc, SEED, RUNS} from './fc-setup.mjs';
import {mock} from 'node:test';

export const FROZEN_NOW = Date.parse('2026-10-07T09:00:00.000Z');
export const TEST_SECRET = 'scopeflow-property-tests-signing-secret-0123456789';

/** Freeze Date for the calling test file (timers stay real). */
export function freezeClock(now = FROZEN_NOW) {
  mock.timers.enable({apis: ['Date'], now});
}
/** A deterministic ISO timestamp `n` seconds after the frozen clock. */
export const tick = n => new Date(FROZEN_NOW + n * 1000).toISOString();

// ---------------------------------------------------------------------------
// Arbitraries for valid Scopeflow content. Text deliberately includes non-ASCII,
// emoji, quotes, backslashes and JSON-significant characters, since all of it is hashed.
// ---------------------------------------------------------------------------
const piece = fc.constantFrom('logo', 'Brand', 'guide', 'page', 'café', 'naïve', 'résumé', '"quoted"', 'back\\slash', 'tab\there', '日本', '🎨', 'Ω', '<b>', '&amp;', 'a,b;c', '{json}', '[1]', '100%', 'x'.repeat(30));
const words = (min, max) => fc.array(piece, {minLength: min, maxLength: max}).map(w => w.join(' '));
export const idArb = fc.stringMatching(/^[A-Za-z0-9_-]{1,12}$/);
export const dateArb = fc.integer({min: Date.parse('2026-01-01'), max: Date.parse('2028-12-31')}).map(ms => new Date(ms - (ms % 86400000)).toISOString().slice(0, 10));
export const moneyArb = fc.integer({min: 0, max: 5_000_000}).map(c => c / 100);

export const itemArb = (id = idArb) => fc.record({
  id,
  title: words(1, 4).map(t => 'Item ' + t),
  qty: fc.integer({min: 1, max: 50}),
  unit: fc.constantFrom('', 'pages', 'concepts', 'hours', 'screens'),
  price: fc.option(moneyArb, {nil: null}),
  acceptance: fc.option(words(0, 4), {nil: ''}).map(x => x ?? ''),
});

export const scopeArb = fc.record({
  title: words(1, 5).map(t => 'Scope ' + t),
  client: words(1, 3).map(t => 'Client ' + t),
  deliverables: fc.constant(''),
  items: fc.uniqueArray(itemArb(), {minLength: 1, maxLength: 6, selector: i => i.id}),
  client_inputs: fc.uniqueArray(fc.record({id: idArb, title: words(1, 3).map(t => 'Input ' + t), due: fc.option(dateArb, {nil: ''}).map(x => x ?? '')}), {maxLength: 3, selector: i => i.id}),
  exclusions: words(0, 6),
  fee: moneyArb,
  currency: fc.constantFrom('USD', 'INR', 'GBP', 'EUR'),
  revisions: fc.integer({min: 0, max: 6}),
  due: fc.option(dateArb, {nil: ''}).map(x => x ?? ''),
  notes: words(0, 6),
});

/** Recursively shuffle the key order of plain objects (arrays keep their order). */
export function shuffleKeys(value, rand) {
  if (Array.isArray(value)) return value.map(v => shuffleKeys(v, rand));
  if (value && typeof value === 'object') {
    const keys = Object.keys(value);
    for (let i = keys.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [keys[i], keys[j]] = [keys[j], keys[i]]; }
    return Object.fromEntries(keys.map(k => [k, shuffleKeys(value[k], rand)]));
  }
  return value;
}
/** Small deterministic PRNG (mulberry32) for helpers that need randomness inside a property. */
export function prng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
export {fc, SEED, RUNS};
