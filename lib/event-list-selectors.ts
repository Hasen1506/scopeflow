import { SUB_EVENT_STATUS_LABEL, type EventVendor, type SubEvent } from './event-collections';

export type SubEventStatusFilter = 'all' | 'upcoming' | 'completed';

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
 * Single-pass O(S) sub-event filtering by status dropdown ('all' | 'upcoming' | 'completed')
 * and real-time text search across title, notes/description, venue, time, date, and coordinator.
 */
export function filterCollectionSubEvents(
  subEvents: readonly SubEvent[],
  statusFilter: SubEventStatusFilter,
  searchQuery: string,
): SubEvent[] {
  const q = searchQuery.trim().toLowerCase();
  const out: SubEvent[] = [];

  for (let i = 0; i < subEvents.length; i += 1) {
    const s = subEvents[i];
    if (statusFilter === 'completed' && s.status !== 'completed') {
      continue;
    }
    if (statusFilter === 'upcoming' && s.status === 'completed') {
      continue;
    }
    if (!q) {
      out.push(s);
      continue;
    }
    const statusLabel = SUB_EVENT_STATUS_LABEL[s.status] ?? s.status;
    const statusGroup = s.status === 'completed' ? 'done' : 'upcoming';
    const haystack =
      `${s.title}\0${s.notes}\0${s.venueName}\0${s.venueAddress}\0${s.timeSlot}\0${s.eventDate}\0${s.coordinatorName}\0${s.coordinatorPhone}\0${s.status}\0${statusLabel}\0${statusGroup}`.toLowerCase();
    if (haystack.includes(q)) {
      out.push(s);
    }
  }
  return out;
}

/**
 * Fast O(V) vendor filtering using the precomputed sub-event title lookup map.
 * Searches name, description/terms, deliverables, contact, phone, email, category, UTR, and linked sub-event.
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
    const haystack =
      `${v.vendorName}\0${v.contactPerson}\0${v.contactPhone}\0${v.contactEmail}\0${v.category}\0${v.utrReference}\0${v.clauseSummary}\0${v.deliverables}\0${subName}`.toLowerCase();
    if (haystack.includes(q)) {
      out.push(v);
    }
  }
  return out;
}

export type SubEventStatusDatum = {
  status: 'planning' | 'locked' | 'confirmed' | 'completed';
  label: string;
  count: number;
};

/**
 * Single-pass O(S) aggregation of sub-events across all four completion statuses
 * (Planning, Locked, Confirmed, Completed) for the Events Hub bar chart.
 */
export function buildSubEventStatusCounts(subEvents: readonly SubEvent[]): SubEventStatusDatum[] {
  let planning = 0;
  let locked = 0;
  let confirmed = 0;
  let completed = 0;

  for (let i = 0; i < subEvents.length; i += 1) {
    const st = subEvents[i].status;
    if (st === 'locked') locked += 1;
    else if (st === 'confirmed') confirmed += 1;
    else if (st === 'completed') completed += 1;
    else planning += 1;
  }

  return [
    { status: 'planning', label: 'Planning', count: planning },
    { status: 'locked', label: 'Locked', count: locked },
    { status: 'confirmed', label: 'Confirmed', count: confirmed },
    { status: 'completed', label: 'Completed', count: completed },
  ];
}

export type SubEventBudgetDatum = {
  id: string;
  label: string;
  fullTitle: string;
  agreedBudget: number;
  actualPaid: number;
  balanceDue: number;
  vendorCount: number;
};

function shortSubEventLabel(title: string): string {
  const clean = title.trim();
  if (clean.length <= 11) return clean;
  // Prefer crisp first word when it clearly identifies the function (e.g. Engagement, Mehendi, Haldi, Sangeet, Wedding, Reception)
  const firstWord = clean.split(/[\s&(/–-]+/)[0]?.trim() ?? '';
  if (firstWord.length >= 4 && firstWord.length <= 11) return firstWord;
  return `${clean.slice(0, 10).trimEnd()}…`;
}

/**
 * Single-pass O(S + V) aggregation of agreed budget vs. actual expenses paid
 * across sub-events (plus a "Shared / All" bar if any vendor spans all sub-events).
 */
export function buildSubEventBudgetComparison(
  subEvents: readonly SubEvent[],
  vendors: readonly EventVendor[],
): SubEventBudgetDatum[] {
  const buckets = new Map<string, { budget: number; paid: number; count: number }>();
  for (let i = 0; i < subEvents.length; i += 1) {
    buckets.set(subEvents[i].id, { budget: 0, paid: 0, count: 0 });
  }

  let sharedBudget = 0;
  let sharedPaid = 0;
  let sharedCount = 0;

  for (let i = 0; i < vendors.length; i += 1) {
    const v = vendors[i];
    const fee = Math.max(0, Number(v.agreedFee) || 0);
    const paid = Math.max(0, Number(v.advancePaid) || 0);
    const bucket = v.subEventId ? buckets.get(v.subEventId) : undefined;
    if (bucket) {
      bucket.budget += fee;
      bucket.paid += paid;
      bucket.count += 1;
    } else {
      sharedBudget += fee;
      sharedPaid += paid;
      sharedCount += 1;
    }
  }

  const out: SubEventBudgetDatum[] = subEvents.map((s) => {
    const b = buckets.get(s.id) ?? { budget: 0, paid: 0, count: 0 };
    return {
      id: s.id,
      label: shortSubEventLabel(s.title),
      fullTitle: s.title,
      agreedBudget: b.budget,
      actualPaid: b.paid,
      balanceDue: Math.max(0, b.budget - b.paid),
      vendorCount: b.count,
    };
  });

  if (sharedCount > 0) {
    out.push({
      id: 'shared',
      label: 'Shared / All',
      fullTitle: 'Shared across all sub-events',
      agreedBudget: sharedBudget,
      actualPaid: sharedPaid,
      balanceDue: Math.max(0, sharedBudget - sharedPaid),
      vendorCount: sharedCount,
    });
  }

  return out;
}
