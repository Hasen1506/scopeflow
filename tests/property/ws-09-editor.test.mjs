// WS-09 part A pure checks: zod issues become human field messages (LT-06), amounts are explained, never
// coerced (LT-07), and units read as plain English (LT-12). Seeded, no network.
// @covers LT-06 LT-07 LT-12
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fc} from '../support/property.mjs';

const {scopeSchema, blank} = await import('../../lib/scope.ts');
const {fieldErrors, humanIssue, validationBanner, amountProblem, maxAmountLabel, FIELD_LABELS} = await import('../../lib/editor.ts');
const {plural, singular, pluralForm} = await import('../../lib/plural.ts');

test('LT-06: an empty scope maps to labelled field messages, no raw schema keys', () => {
  const r = scopeSchema.safeParse({...blank, title: '', client: '', deliverables: '', items: []});
  assert.equal(r.success, false);
  const f = fieldErrors(r.error.issues);
  assert.equal(f.title, 'Use at least 3 characters');
  assert.equal(f.client, 'Use at least 2 characters');
  assert.equal(f.deliverables, 'Add at least one deliverable');
  const banner = validationBanner(f);
  assert.match(banner, /Project name, Client, Deliverables/);
  for (const msg of [...Object.values(f), banner]) assert.doesNotMatch(msg, /\b(title|client|deliverables|too_small|String must)\b/);
});

test('LT-06: item issues name the deliverable by position; numbers read as limits', () => {
  assert.equal(humanIssue({path: ['items', 1, 'title'], code: 'too_small', type: 'string', minimum: 2, message: 'x'}), 'Deliverable 2 name: use at least 2 characters');
  assert.equal(humanIssue({path: ['fee'], code: 'too_small', type: 'number', minimum: 0, message: 'x'}), 'Can’t be negative');
  assert.equal(humanIssue({path: ['revisions'], code: 'too_big', type: 'number', maximum: 50, message: 'x'}), 'Use 50 or less');
  assert.deepEqual(fieldErrors([{path: ['items', 0, 'price'], code: 'too_small', type: 'number', minimum: 0, message: 'x'}]), {deliverables: 'Deliverable 1 price: can’t be negative'});
});

test('LT-06 property: every schema issue for a random draft maps to a known field and a non-key message', () => {
  const text = fc.string({maxLength: 6});
  fc.assert(fc.property(text, text, fc.integer({min: -5, max: 60}), fc.double({min: -1e9, max: 1e9, noNaN: true}), (title, client, revisions, fee) => {
    const r = scopeSchema.safeParse({...blank, title, client, revisions, fee, deliverables: ''});
    if (r.success) return;
    const f = fieldErrors(r.error.issues);
    for (const [k, v] of Object.entries(f)) { assert.ok(FIELD_LABELS[k], k); assert.ok(v.length > 3); assert.ok(!v.includes(k + ':')); }
  }));
});

test('LT-07: amounts are explained, not coerced', () => {
  assert.equal(amountProblem(-500, 'INR'), "Price can't be negative");
  assert.equal(amountProblem(99_999_999_999, 'INR'), 'Max ₹1,00,00,000');
  assert.equal(maxAmountLabel('INR'), '₹1,00,00,000');
  assert.equal(amountProblem(10_000_000, 'INR'), null);
  assert.equal(amountProblem(null, 'INR'), null);
  assert.equal(amountProblem(-1, 'USD', 'The fee'), "The fee can't be negative");
});

test('LT-12: plural units', () => {
  assert.equal(plural('concept', 1), '1 concept');
  assert.equal(plural('concepts', 1), '1 concept');
  assert.equal(plural('concept', 3), '3 concepts');
  assert.equal(plural('pages', 12), '12 pages');
  assert.equal(plural('hours', 1.5), '1.5 hours');
  assert.equal(plural('copy', 2), '2 copies');
  assert.equal(plural('boxes', 1), '1 box');
  assert.equal(plural('A4 pages', 1), '1 A4 page');
  assert.equal(plural('', 4), '4');
  fc.assert(fc.property(fc.constantFrom('concept', 'page', 'round', 'screen', 'album', 'hour', 'day'), w => singular(pluralForm(w)) === w));
});
