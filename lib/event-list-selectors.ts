import type { EventVendor, SubEvent } from './event-collections';

/**
 * O(S) lookup map from sub-event id -> sub-event title so vendor cards
 * never scan `subEvents.find(...)` inside render loops.
 */
export function buildSubEventTitleMap(subEvents: readonly SubEvent[]): Map<string, string> {
  const map = new Map<string, string>();
  for (let i = 0; i < subEvents.length; i += 1) {
    map.set(subEvents[i].id, subEvents[i].title);
  }
  return map;
}

/**
 * Single-pass O(S + V) count of vendors linked to each sub-event
 * (including global `subEventId === null` vendors that apply to every sub-event).
 */
export function buildVendorCountBySubEvent(
  subEvents: readonly SubEvent[],
  vendors: readonly EventVendor[],
): Map<string, number> {
  const counts = new Map<string, number>();
  let globalCount = 0;
  const perSub = new Map<string, number>();

  for (let i = 0; i < vendors.length; i += 1) {
    const sid = vendors[i].subEventId;
    if (sid === null) {
      globalCount += 1;
    } else {
      perSub.set(sid, (perSub.get(sid) ?? 0) + 1);
    }
  }

  for (let i = 0; i < subEvents.length; i += 1) {
    const id = subEvents[i].id;
    counts.set(id, globalCount + (perSub.get(id) ?? 0));
  }
  return counts;
}

/**
 * Fast O(V) vendor filtering using the precomputed sub-event title lookup map.
 */
export function filterCollectionVendors(
  vendors: readonly EventVendor[],
  subEventTitleMap: ReadonlyMap<string, string>,
  selectedSubId: string,
  searchQuery: string,
): EventVendor[] {
  const q = searchQuery.trim().toLowerCase();
  const out: EventVendor[] = [];

  for (let i = 0; i < vendors.length; i += 1) {
    const v = vendors[i];
    if (selectedSubId !== 'all' && v.subEventId !== selectedSubId && v.subEventId !== null) {
      continue;
    }
    if (!q) {
      out.push(v);
      continue;
    }
    const subName = v.subEventId ? (subEventTitleMap.get(v.subEventId) ?? '') : '';
    const haystack = `${v.vendorName}\0${v.contactPerson}\0${v.contactPhone}\0${v.contactEmail}\0${v.category}\0${v.utrReference}\0${v.clauseSummary}\0${subName}`.toLowerCase();
    if (haystack.includes(q)) {
      out.push(v);
    }
  }
  return out;
}
