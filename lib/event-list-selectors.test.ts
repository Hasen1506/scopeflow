import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildSubEventTitleMap,
  buildVendorCountBySubEvent,
  filterCollectionVendors,
} from './event-list-selectors';
import type { EventVendor, SubEvent } from './event-collections';

function makeSub(id: string, title: string): SubEvent {
  return {
    id,
    collectionId: 'col_1',
    sortOrder: 0,
    title,
    eventDate: '2026-12-12',
    timeSlot: '7:00 PM',
    venueName: 'Hall A',
    venueAddress: 'Jaipur',
    guestCount: 200,
    coordinatorName: '',
    coordinatorPhone: '',
    status: 'planning',
    notes: '',
  };
}

function makeVendor(id: string, subEventId: string | null, overrides: Partial<EventVendor> = {}): EventVendor {
  return {
    id,
    collectionId: 'col_1',
    subEventId,
    category: 'catering',
    vendorName: `Vendor ${id}`,
    contactPerson: 'Raj',
    contactPhone: '+91 98000 00001',
    contactEmail: '',
    whatsappNumber: '+91 98000 00001',
    agreedFee: 100000,
    advancePaid: 25000,
    paymentDueDate: '',
    utrReference: `UTR_${id}`,
    agreementStatus: 'draft',
    clauseSummary: 'Standard fixed quote',
    deliverables: '',
    ...overrides,
  };
}

test('buildVendorCountBySubEvent counts specific + global (null) vendors in O(S + V)', () => {
  const subs = [makeSub('s1', 'Haldi'), makeSub('s2', 'Sangeet'), makeSub('s3', 'Reception')];
  const vendors = [
    makeVendor('v1', 's1'),
    makeVendor('v2', 's1'),
    makeVendor('v3', 's2'),
    makeVendor('v4', null), // applies to all sub-events
  ];
  const counts = buildVendorCountBySubEvent(subs, vendors);
  assert.equal(counts.get('s1'), 3);
  assert.equal(counts.get('s2'), 2);
  assert.equal(counts.get('s3'), 1);
});

test('filterCollectionVendors filters by selected sub-event, UTR, and sub-event title', () => {
  const subs = [makeSub('s1', 'Royal Sangeet'), makeSub('s2', 'Haldi Lawn')];
  const titleMap = buildSubEventTitleMap(subs);
  const vendors = [
    makeVendor('v1', 's1', { vendorName: 'DJ Pulse', utrReference: 'UTR9988' }),
    makeVendor('v2', 's2', { vendorName: 'Marigold Decor', utrReference: 'UTR1122' }),
    makeVendor('v3', null, { vendorName: 'LensCraft Photo', utrReference: 'UTR5544' }),
  ];

  // Filter by sub-event s1 includes s1 + global null
  const s1List = filterCollectionVendors(vendors, titleMap, 's1', '');
  assert.deepEqual(
    s1List.map((v) => v.id),
    ['v1', 'v3'],
  );

  // Filter by UTR across all sub-events
  const utrMatch = filterCollectionVendors(vendors, titleMap, 'all', 'utr1122');
  assert.deepEqual(
    utrMatch.map((v) => v.id),
    ['v2'],
  );

  // Filter by linked sub-event name
  const subTitleMatch = filterCollectionVendors(vendors, titleMap, 'all', 'royal sangeet');
  assert.deepEqual(
    subTitleMatch.map((v) => v.id),
    ['v1'],
  );
});

test('high-volume Events Hub selectors handle 50 sub-events x 500 vendors quickly', () => {
  const subs = Array.from({ length: 50 }, (_, i) => makeSub(`s_${i}`, `Ceremony Day ${i + 1}`));
  const vendors = Array.from({ length: 500 }, (_, i) =>
    makeVendor(`v_${i}`, i % 10 === 0 ? null : `s_${i % 50}`, {
      utrReference: `UTR_HIGH_${i}`,
    }),
  );

  const t0 = performance.now();
  const titleMap = buildSubEventTitleMap(subs);
  const counts = buildVendorCountBySubEvent(subs, vendors);
  const filtered = filterCollectionVendors(vendors, titleMap, 's_7', 'utr_high_7');
  const elapsedMs = performance.now() - t0;

  assert.equal(counts.size, 50);
  // 50 global vendors (i % 10 === 0) + 10 specific to s_7 (7, 57, ..., 457)
  assert.equal(counts.get('s_7'), 60);
  assert.ok(filtered.some((v) => v.id === 'v_7'));
  assert.ok(elapsedMs < 50, `Expected high-volume selector pass < 50ms, got ${elapsedMs.toFixed(2)}ms`);
});
