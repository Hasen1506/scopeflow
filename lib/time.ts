// PR C: every time shown to the creator or the client names its zone. Timestamps are stored in
// UTC (ISO 8601); they are displayed in the project's time zone (set by the creator) with the
// zone's offset, e.g. "7 Oct 2026, 14:30 GMT+5:30".

export const DEFAULT_TIME_ZONE = 'UTC';
/** True for an IANA zone this runtime understands. */
export function validTimeZone(tz: unknown): tz is string {
  if (typeof tz !== 'string' || !tz || tz.length > 64 || !/^[A-Za-z0-9_+\-/]+$/.test(tz)) return false;
  try { new Intl.DateTimeFormat('en-GB', {timeZone: tz}); return true; } catch { return false; }
}
/** The zone to display in: the project's when valid, else UTC. */
export function zoneOrUtc(tz: string | null | undefined) { return validTimeZone(tz) ? tz : DEFAULT_TIME_ZONE; }

/** "7 Oct 2026, 14:30 GMT+5:30" (or "… UTC"). Empty for a missing or invalid timestamp. */
export function formatInZone(iso: string | null | undefined, tz?: string | null) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const zone = zoneOrUtc(tz);
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {timeZone: zone, day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZoneName: 'shortOffset'}).formatToParts(d).map(p => [p.type, p.value]));
  const name = zone === 'UTC' ? 'UTC' : parts.timeZoneName;
  return `${parts.day} ${parts.month} ${parts.year}, ${parts.hour}:${parts.minute} ${name}`;
}
/** A calendar date ("2026-12-15") as "15 Dec 2026". Dates carry no time zone, so they are formatted in UTC; anything else is returned unchanged. */
export function formatDay(day: string | null | undefined) {
  if (!day) return '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return day;
  const d = new Date(day + 'T00:00:00Z');
  return Number.isNaN(d.getTime()) ? day : new Intl.DateTimeFormat('en-GB', {timeZone: 'UTC', day: 'numeric', month: 'short', year: 'numeric'}).format(d);
}
/** Zones offered in the editor: the runtime's IANA list when available, plus UTC. */
/** Whole days since an ISO timestamp, as plain words: "today", "yesterday", "6 days ago". */
export function daysAgo(iso: string | null | undefined, now = Date.now()) {
  const t = iso ? Date.parse(iso) : NaN;
  if (Number.isNaN(t)) return {days: 0, text: ''};
  const days = Math.max(0, Math.floor((now - t) / 86400000));
  return {days, text: days === 0 ? 'today' : days === 1 ? 'yesterday' : `${days} days ago`};
}
export function timeZones(): string[] {
  const intl = Intl as unknown as {supportedValuesOf?: (key: string) => string[]};
  const list = intl.supportedValuesOf?.('timeZone') ?? ['Asia/Kolkata', 'Europe/London', 'America/New_York', 'America/Los_Angeles', 'Asia/Singapore', 'Asia/Dubai', 'Australia/Sydney'];
  return ['UTC', ...list.filter(z => z !== 'UTC')];
}
