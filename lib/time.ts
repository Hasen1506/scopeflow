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
/** Whole days since an ISO timestamp, as plain words: "today", "yesterday", "6 days ago". */
export function daysAgo(iso: string | null | undefined, now = Date.now()) {
  const t = iso ? Date.parse(iso) : NaN;
  if (Number.isNaN(t)) return {days: 0, text: ''};
  const days = Math.max(0, Math.floor((now - t) / 86400000));
  return {days, text: days === 0 ? 'today' : days === 1 ? 'yesterday' : `${days} days ago`};
}
/** Zones offered in the editor: the runtime's IANA list when available, plus UTC. */
export function timeZones(): string[] {
  const intl = Intl as unknown as {supportedValuesOf?: (key: string) => string[]};
  const list = intl.supportedValuesOf?.('timeZone') ?? ['Asia/Kolkata', 'Europe/London', 'America/New_York', 'America/Los_Angeles', 'Asia/Singapore', 'Asia/Dubai', 'Australia/Sydney'];
  return ['UTC', ...list.filter(z => z !== 'UTC')];
}

/** Receipt form: "2026-10-07 09:00:00 UTC" plus the same instant in `tz` with its offset and IANA name. */
export function stamp(iso: string | null, tz: string) {
  if (!iso) return 'not recorded';
  const d = new Date(iso);
  const utc = d.toISOString().replace('T', ' ').replace(/\.\d+Z$/, ' UTC');
  if (tz === 'UTC' || !validTimeZone(tz)) return utc;
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23', timeZoneName: 'shortOffset'}).formatToParts(d).map(p => [p.type, p.value]));
  return `${utc} (${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second} ${parts.timeZoneName}, ${tz})`;
}
/** B-5/#51: the zone a new project starts in: the account's zone, else the browser's, else none (UTC). Pure. */
export function newProjectZone(accountZone: string | null | undefined, browserZone: string | null | undefined): string | null {
  if (validTimeZone(accountZone)) return accountZone;
  if (validTimeZone(browserZone)) return browserZone;
  return null;
}

/** #34: legacy IANA aliases some runtimes still report (Chrome in India gives "Asia/Calcutta"). */
const ZONE_ALIASES: Record<string, string> = {'Asia/Calcutta': 'Asia/Kolkata', 'Asia/Katmandu': 'Asia/Kathmandu', 'Asia/Saigon': 'Asia/Ho_Chi_Minh', 'Asia/Rangoon': 'Asia/Yangon', 'Europe/Kiev': 'Europe/Kyiv', 'America/Buenos_Aires': 'America/Argentina/Buenos_Aires', 'Etc/UTC': 'UTC', 'Etc/GMT': 'UTC', 'GMT': 'UTC', 'Universal': 'UTC', 'Zulu': 'UTC'};
/** The canonical name for a zone (aliases mapped, falling back to the alias if this runtime lacks the canonical one). Pure. */
export function canonicalZone(tz: string): string;
export function canonicalZone(tz: string | null | undefined): string | null;
export function canonicalZone(tz: string | null | undefined): string | null {
  if (!tz) return null;
  const c = ZONE_ALIASES[tz];
  return c && validTimeZone(c) ? c : tz;
}
/**
 * #17: the zone a project created through the API starts in, server side: the zone the request names,
 * else the account's saved zone, else none (UTC). Canonical names. Pure.
 */
export function serverProjectZone(requested: unknown, accountZone: string | null | undefined): string | null {
  for (const z of [requested, accountZone]) if (validTimeZone(z)) return canonicalZone(z);
  return null;
}
/**
 * #17: the browser zone to save as the account's zone right after sign-in/sign-up, only when the
 * account has none saved yet (so API-created projects stop defaulting to UTC). Null = save nothing. Pure.
 */
export function zoneToAdopt(savedAccountZone: string | null | undefined, browserZone: string | null | undefined): string | null {
  if (validTimeZone(savedAccountZone) || !validTimeZone(browserZone)) return null;
  return canonicalZone(browserZone);
}
