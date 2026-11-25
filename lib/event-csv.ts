import {
  SUB_EVENT_STATUS_LABEL,
  type EventCollection,
  type SubEvent,
} from './event-collections';
import { buildVendorCountBySubEvent } from './event-list-selectors';

const FORMULA_PREFIX = /^[=+\-@\t\r]/;

/**
 * Escapes a value per RFC 4180 and neutralizes spreadsheet formula injection
 * (cells starting with =, +, -, @, tab, or CR get a leading apostrophe).
 */
export function csvEscapeCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '';
  let text = String(value);
  if (typeof value === 'string' && FORMULA_PREFIX.test(text)) {
    text = `'${text}`;
  }
  if (/[",\r\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

export const SUB_EVENTS_CSV_HEADERS = [
  'Main Event',
  'Sub-Event #',
  'Sub-Event Name',
  'Status',
  'Date',
  'Time Slot',
  'Venue',
  'Guests',
  'Coordinator',
  'Coordinator Phone',
  'Vendors Linked',
  'Agreed Budget',
  'Advance Paid',
  'Balance Due',
  'Currency',
  'Notes',
] as const;

/**
 * Builds an RFC 4180 CSV export for a collection's sub-events (or a filtered subset),
 * rolling up linked vendor count, agreed budget, advance paid, and balance due per sub-event.
 */
export function buildSubEventsCsv(
  collection: EventCollection,
  subEvents: readonly SubEvent[] = collection.subEvents,
): string {
  const vendorCounts = buildVendorCountBySubEvent(subEvents, collection.vendors);
  const financialsBySub = new Map<string, { budget: number; paid: number }>();

  for (let i = 0; i < collection.vendors.length; i += 1) {
    const v = collection.vendors[i];
    if (!v.subEventId) continue;
    const prev = financialsBySub.get(v.subEventId) ?? { budget: 0, paid: 0 };
    prev.budget += Math.max(0, Number(v.agreedFee) || 0);
    prev.paid += Math.max(0, Number(v.advancePaid) || 0);
    financialsBySub.set(v.subEventId, prev);
  }

  const lines: string[] = [SUB_EVENTS_CSV_HEADERS.map(csvEscapeCell).join(',')];

  for (let i = 0; i < subEvents.length; i += 1) {
    const sub = subEvents[i];
    const fin = financialsBySub.get(sub.id) ?? { budget: 0, paid: 0 };
    const balance = Math.max(0, fin.budget - fin.paid);
    const linkedVendors = vendorCounts.get(sub.id) ?? 0;

    const row = [
      collection.title,
      i + 1,
      sub.title,
      SUB_EVENT_STATUS_LABEL[sub.status] ?? sub.status,
      sub.eventDate || '',
      sub.timeSlot || '',
      sub.venueName || '',
      sub.guestCount > 0 ? sub.guestCount : 0,
      sub.coordinatorName || '',
      sub.coordinatorPhone || '',
      linkedVendors,
      fin.budget,
      fin.paid,
      balance,
      collection.currency,
      sub.notes || '',
    ];

    lines.push(row.map(csvEscapeCell).join(','));
  }

  return lines.join('\r\n');
}

/**
 * Generates a safe, human-readable filename for the sub-events CSV export.
 */
export function buildSubEventsCsvFilename(collectionTitle: string): string {
  const slug = collectionTitle
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return `${slug || 'event-collection'}-sub-events.csv`;
}
