// Clarity check rewrites (lib/lint.ts): a suggestion replaces only the vague phrase, in the field it
// was found in, and applying every suggestion leaves no vague phrase that had one.
import '../support/fc-setup.mjs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fc} from '../support/property.mjs';

const {lintScope, applyRewrite} = await import('../../lib/lint.ts');
const {scopeSchema} = await import('../../lib/scope.ts');
const base = {title: 'Brand identity', client: 'Acme', deliverables: '', items: [{id: 'a', title: 'Logo suite', acceptance: 'SVG and PNG'}], exclusions: 'Print', fee: 1000, currency: 'USD', revisions: 2, due: '', notes: 'One round is one consolidated feedback list.'};
const scope = over => scopeSchema.parse({...base, ...over});
const withRewrites = s => lintScope(s, '2026-10-01').issues.filter(i => i.rewrite);

test('suggestions are concrete and land in the right field', () => {
  const s = scope({notes: 'Includes minor tweaks and unlimited revisions, including but not limited to colour changes, etc.', items: [{id: 'a', title: 'Social posts', qty: 12, unit: 'posts', acceptance: 'Approximately 10 hashtags each'}]});
  const issues = withRewrites(s);
  const replaces = issues.map(i => i.rewrite.replace);
  assert.ok(replaces.includes('changes within the 2 included revision rounds'));
  assert.ok(replaces.includes('2 revision rounds'));
  assert.ok(replaces.includes('consisting of'));
  assert.ok(replaces.includes('up to '));
  assert.ok(replaces.includes(''), 'etc. is removed');
  const acceptance = issues.find(i => i.subfield === 'acceptance');
  assert.equal(applyRewrite(s, acceptance).items[0].acceptance, 'up to 10 hashtags each');
  assert.equal(applyRewrite(s, acceptance).notes, s.notes, 'other fields untouched');
  // "unlimited revisions" is reported once, as an error with a rewrite.
  assert.equal(lintScope(s, '2026-10-01').issues.filter(i => /unlimited/i.test(i.message)).length, 1);
});

test('applying every suggestion removes those findings and keeps the scope valid', () => {
  const phrase = fc.constantFrom('minor tweaks', 'small changes', 'unlimited revisions', 'including but not limited to', 'etc.', 'and so on', 'approximately 5');
  fc.assert(fc.property(fc.array(phrase, {minLength: 1, maxLength: 4}), fc.integer({min: 0, max: 5}), (phrases, revisions) => {
    let s = scope({revisions, notes: 'One round is one consolidated feedback list. ' + phrases.map((p, n) => `Clause ${n + 1}: ${p}`).join('. ')});
    for (let guard = 0; guard < 10; guard++) {
      const next = withRewrites(s)[0];
      if (!next) break;
      s = scopeSchema.parse(applyRewrite(s, next));
    }
    assert.equal(withRewrites(s).length, 0);
    assert.ok(!/\s{2}|\s[,.]/.test(s.notes), s.notes);
  }), {numRuns: 60});
});

test('issues without a safe rewrite still say what to write instead', () => {
  const issues = lintScope(scope({notes: 'Support as needed, ongoing, details TBD.'}), '2026-10-01').issues.filter(i => i.rule === 'vague-language');
  assert.ok(issues.length >= 3);
  for (const i of issues) { assert.ok(i.fix && i.fix !== 'Replace it with an exact list, number or limit.'); assert.equal(i.rewrite, undefined); }
});

test('stamp duty: flagged for high-value INR agreements, not for others or once noted', () => {
  const rules = over => lintScope(scope(over), '2026-10-01').issues.map(i => i.rule);
  assert.ok(rules({currency: 'INR', fee: 150000}).includes('stamp-duty'));
  assert.ok(!rules({currency: 'INR', fee: 50000}).includes('stamp-duty'));
  assert.ok(!rules({currency: 'USD', fee: 150000}).includes('stamp-duty'));
  assert.ok(!rules({currency: 'INR', fee: 150000, notes: 'One round is one consolidated feedback list. E-stamp IN-KA123 attached.'}).includes('stamp-duty'));
});
