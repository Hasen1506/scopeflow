// Calendar dates (delivery, client inputs) are shown as "15 Dec 2026" everywhere. Pure, no server.
import '../support/fc-setup.mjs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fc} from '../support/property.mjs';

const {formatDay} = await import('../../lib/time.ts');
const {semanticDiff, describeChange} = await import('../../lib/diff.ts');
const {blank} = await import('../../lib/scope.ts');

test('formatDay: ISO dates read as day month year; anything else is returned unchanged', () => {
  assert.equal(formatDay('2026-12-15'), '15 Dec 2026');
  assert.equal(formatDay('2026-01-01'), '1 Jan 2026');
  assert.equal(formatDay(''), '');
  assert.equal(formatDay(null), '');
  assert.equal(formatDay('next week'), 'next week');
});

test('property: formatDay never shifts the day, whatever the host time zone', () => {
  fc.assert(fc.property(fc.date({min: new Date('2000-01-01T00:00:00Z'), max: new Date('2099-12-31T00:00:00Z'), noInvalidDate: true}), d => {
    const iso = d.toISOString().slice(0, 10);
    const [y, , day] = iso.split('-');
    assert.match(formatDay(iso), new RegExp(`^${Number(day)} [A-Z][a-z]{2,3} ${y}$`));
  }));
});

test('version diffs show client-input dates the same way', () => {
  const before = {...blank, title: 'T', client: 'C', client_inputs: []};
  const after = {...before, client_inputs: [{id: 'c1', title: 'Brand assets', due: '2026-10-20'}]};
  const lines = semanticDiff(before, after).map(c => describeChange(c, 'USD'));
  assert.ok(lines.includes('Client now provides: Brand assets by 20 Oct 2026'), lines.join(' | '));
});
