import test from 'node:test';
import assert from 'node:assert/strict';
import { blank } from './scope';
import {
  MAX_PARKED_DRAFTS,
  parkedDraftsKey,
  readParkedDrafts,
  removeParkedDraft,
  upsertParkedDraft,
  writeParkedDrafts,
} from './parked-drafts';

function memoryStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => {
      map.set(k, v);
    },
    removeItem: (k: string) => {
      map.delete(k);
    },
  };
}

test('parks multiple half-done drafts per account without overwriting or duplicating', () => {
  const store = memoryStorage();
  const draft1 = { ...blank, title: 'Indiranagar 2BHK Move-In', client: 'Mr. Sharma', fee: 120000 };
  const draft2 = { ...blank, title: 'Wedding Sangeet Catering', client: 'Kapoor Family', fee: 250000 };

  let list = upsertParkedDraft([], draft1, 'sharma@example.com', { id: 'd1', now: '2026-11-20T10:00:00.000Z' });
  list = upsertParkedDraft(list, draft2, '', { id: 'd2', now: '2026-11-20T10:05:00.000Z' });
  // Re-parking identical draft updates timestamp without creating a duplicate entry
  list = upsertParkedDraft(list, draft1, 'sharma@example.com', { now: '2026-11-20T10:10:00.000Z' });

  assert.equal(list.length, 2);
  assert.equal(list[0].draft.title, 'Indiranagar 2BHK Move-In');
  assert.equal(list[1].draft.title, 'Wedding Sangeet Catering');

  writeParkedDrafts(store, 'acct_1', list);
  const loaded = readParkedDrafts(store, 'acct_1');
  assert.equal(loaded.length, 2);
  assert.equal(loaded[0].clientEmail, 'sharma@example.com');
  assert.equal(readParkedDrafts(store, 'acct_2').length, 0);
  assert.notEqual(parkedDraftsKey('acct_1'), parkedDraftsKey('acct_2'));

  const afterRemove = removeParkedDraft(loaded, 'd1');
  assert.equal(afterRemove.length, 1);
  assert.equal(afterRemove[0].id, 'd2');
});

test('caps parked drafts at MAX_PARKED_DRAFTS and tolerates malformed storage', () => {
  const store = memoryStorage();
  store.setItem(parkedDraftsKey('acct_bad'), '{broken json');
  assert.deepEqual(readParkedDrafts(store, 'acct_bad'), []);

  let list = [] as ReturnType<typeof upsertParkedDraft>;
  for (let i = 0; i < MAX_PARKED_DRAFTS + 5; i++) {
    list = upsertParkedDraft(list, { ...blank, title: `Draft #${i}`, client: `Client ${i}` }, '', { id: `id_${i}` });
  }
  assert.equal(list.length, MAX_PARKED_DRAFTS);
  assert.equal(list[0].draft.title, `Draft #${MAX_PARKED_DRAFTS + 4}`);
});
