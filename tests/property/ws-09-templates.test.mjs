// WS-09 part B pure checks for templates: every built-in starter and vertical pack validates against
// scopeSchema with stable ids (SF-22); revision diffs, search and mode ordering for the Templates
// section (SF-18). No network.
// @covers SF-22 SF-18
import {test} from 'node:test';
import assert from 'node:assert/strict';
import '../support/property.mjs';

const {scopeSchema} = await import('../../lib/scope.ts');
const {templates, verticalPacks, startersFor} = await import('../../lib/templates.ts');
const {builtinTemplates, templateContent, revisionDiff, filterTemplates} = await import('../../lib/template-store.ts');

// Ids are referenced by projects, change orders and the rate-card picker: this list only ever grows.
const STABLE = {
  'wedding-photographer': ['w_coverage', 'w_photos', 'w_album', 'w_gallery'],
  'interiors-boq': ['b_design', 'b_civil', 'b_ceiling', 'b_kitchen', 'b_wardrobes', 'b_paint'],
  'ca-retainer': ['ca_books', 'ca_gst', 'ca_tds', 'ca_mis'],
  'agency-social-retainer': ['s_plan', 's_posts', 's_reels', 's_report'],
};

test('SF-22: every built-in template validates against scopeSchema once a client is named', () => {
  assert.ok(templates.length >= 12);
  for (const t of templates) {
    const r = scopeSchema.safeParse({...t.content, client: 'Fictional Client'});
    assert.ok(r.success, `${t.id}: ${r.success ? '' : r.error.issues.map(i => i.path.join('.') + ' ' + i.message).join('; ')}`);
    const c = templateContent(t.content);
    assert.ok('content' in c, t.id);
    assert.equal(c.content.client, '', 'templates leave the client blank');
    assert.ok(t.modes.length > 0, `${t.id} is suggested in at least one mode`);
  }
});

test('SF-22: vertical packs keep stable template and item ids', () => {
  assert.deepEqual(verticalPacks.map(p => p.id), Object.keys(STABLE));
  for (const p of verticalPacks) assert.deepEqual(p.content.items.map(i => i.id), STABLE[p.id], p.id);
  const ids = templates.map(t => t.id);
  assert.equal(new Set(ids).size, ids.length, 'template ids are unique');
  assert.deepEqual(builtinTemplates().map(t => t.id), ids.map(id => 'builtin:' + id));
  for (const id of ['brand', 'website', 'content', 'mobile-app', 'seo-retainer', 'video', 'copywriting', 'workshop']) assert.ok(ids.includes(id), `starter ${id} kept`);
});

test('SF-22: each pack has the shape its trade needs', () => {
  const by = Object.fromEntries(verticalPacks.map(p => [p.id, p]));
  assert.deepEqual(by['wedding-photographer'].rate_card.map(r => r.id), ['rc_extra_hour', 'rc_extra_album', 'rc_drone']);
  for (const id of ['wedding-photographer', 'interiors-boq']) assert.equal(by[id].content.milestones.reduce((s, m) => s + m.pct, 0), 100);
  assert.ok(by['interiors-boq'].content.milestones.filter(m => /inspection/i.test(m.title)).length >= 2, 'stage inspections');
  for (const id of ['ca-retainer', 'agency-social-retainer']) {
    const c = by[id].content, items = new Set(c.items.map(i => i.id));
    assert.equal(c.engagement, 'retainer');
    assert.equal(c.retainer.period, 'monthly');
    assert.ok(c.retainer.quotas.every(q => items.has(q.item_id)), `${id} quotas name its deliverables`);
  }
  for (const p of verticalPacks) { assert.equal(p.content.currency, 'INR'); assert.equal(p.content.tax_pct, 18); }
});

test('SF-18: a mode orders starters but never hides one', () => {
  for (const mode of ['freelancer', 'agency', 'consumer', 'enterprise']) {
    const list = startersFor(mode);
    assert.equal(list.length, templates.length);
    const firstOther = list.findIndex(t => !t.modes.includes(mode));
    assert.ok(firstOther === -1 || list.slice(firstOther).every(t => !t.modes.includes(mode)), mode);
  }
  assert.equal(startersFor('agency')[0].modes.includes('agency'), true);
});

test('SF-18: revision diff names the rename and the scope changes', () => {
  const base = templates.find(t => t.id === 'website').content;
  const r1 = {name: 'Website', content: base};
  const r3 = {name: 'Website v3', content: {...base, fee: 1500, items: [...base.items, {id: 'i_seo', title: 'SEO setup', qty: 1, unit: '', price: null, acceptance: ''}]}};
  const lines = revisionDiff(r1, r3);
  assert.equal(lines[0], 'Renamed “Website” to “Website v3”');
  assert.ok(lines.some(l => /SEO setup/.test(l)), lines.join(' | '));
  assert.ok(lines.some(l => /fee/i.test(l)), lines.join(' | '));
  assert.deepEqual(revisionDiff(r1, r1), []);
});

test('SF-18: search matches name, title, pack and tags; the tag filter narrows it', () => {
  const list = builtinTemplates();
  assert.deepEqual(filterTemplates(list, 'wedding').map(t => t.id), ['builtin:wedding-photographer']);
  assert.ok(filterTemplates(list, 'RETAINER').length >= 3);
  assert.deepEqual(filterTemplates(list, '', 'boq').map(t => t.id), ['builtin:interiors-boq']);
  assert.equal(filterTemplates(list, '').length, list.length);
});
