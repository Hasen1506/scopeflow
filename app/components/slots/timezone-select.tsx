'use client';
// Slot: TimezoneSelect. Owner: WS-08 (implements it). Mounted by: WS-08 (account), WS-09 (workspace).
// LT-16: an IANA time-zone picker that is a searchable combobox instead of ~400 raw options:
// the account's zone (or the browser's) is the default, common zones come first, and typing
// filters by any part of the name ("Kolk" → Asia/Kolkata, "india" → Asia/Kolkata).
import {useId, useMemo, useRef, useState, type KeyboardEvent} from 'react';
import {canonicalZone, timeZones} from '@/lib/time';
import styles from '../timezone-select.module.css';

export const COMMON_ZONES = ['Asia/Kolkata', 'UTC', 'Asia/Dubai', 'Asia/Singapore', 'Europe/London', 'Europe/Berlin', 'America/New_York', 'America/Chicago', 'America/Los_Angeles', 'Australia/Sydney', 'Asia/Colombo', 'Asia/Dhaka', 'Asia/Kathmandu'] as const;
const ALIASES: Record<string, string> = {'Asia/Kolkata': 'India IST Calcutta Mumbai Delhi Chennai Bengaluru', 'Asia/Dubai': 'UAE Gulf', 'Europe/London': 'UK GMT BST Britain', 'America/New_York': 'US Eastern ET', 'America/Los_Angeles': 'US Pacific PT', 'America/Chicago': 'US Central CT', 'Asia/Singapore': 'SGT', 'Australia/Sydney': 'AEST AEDT'};
/** Zones matching `query` (case-insensitive substring of the name or a common alias), common ones first. Pure. */
export function filterZones(all: readonly string[], query: string, limit = 60) {
  const q = query.trim().toLowerCase().replace(/\s+/g, '_');
  // Common zones are always offered, even when the runtime lists only a legacy alias (ICU may
  // list Asia/Calcutta instead of Asia/Kolkata); both names are valid IANA zones.
  // #34: a legacy alias of a common zone (Asia/Calcutta) is not listed twice.
  const ordered = [...COMMON_ZONES, ...all.filter(z => !(COMMON_ZONES as readonly string[]).includes(canonicalZone(z)))];
  const hit = (z: string) => !q || z.toLowerCase().includes(q) || (ALIASES[z] ?? '').toLowerCase().includes(q.replace(/_/g, ' '));
  return ordered.filter(hit).slice(0, limit);
}
/** #34: shown under its canonical name (a stored "Asia/Calcutta" reads as Asia/Kolkata). */
const label = (z: string) => canonicalZone(z).replace(/_/g, ' ');

export type TimezoneSelectProps = {
  value: string; onChange: (zone: string) => void;
  /** Visible label (default "Time zone"). */ label?: string;
  /** Shown as the hint: the account's zone, offered as the default. */ accountZone?: string | null;
  id?: string; disabled?: boolean;
};

export default function TimezoneSelect({value, onChange, label: text = 'Time zone', accountZone, id, disabled}: TimezoneSelectProps) {
  const auto = useId(), inputId = id ?? 'tz-' + auto, listId = inputId + '-list', hintId = inputId + '-hint';
  const all = useMemo(() => timeZones(), []);
  const [query, setQuery] = useState<string | null>(null), [open, setOpen] = useState(false), [active, setActive] = useState(0);
  const options = useMemo(() => filterZones(all, query ?? ''), [all, query]);
  const blurTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const choose = (z: string) => { onChange(z); setQuery(null); setOpen(false); };
  function key(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setActive(a => Math.min(a + 1, options.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(a => Math.max(a - 1, 0)); }
    else if (e.key === 'Enter' && open && options[active]) { e.preventDefault(); choose(options[active]); }
    else if (e.key === 'Escape') { setQuery(null); setOpen(false); }
  }
  return <div className={styles.wrap}>
    <label htmlFor={inputId}>{text}</label>
    <input id={inputId} role="combobox" aria-expanded={open} aria-controls={listId} aria-autocomplete="list" aria-describedby={hintId} autoComplete="off" spellCheck={false} disabled={disabled}
      aria-activedescendant={open && options[active] ? `${listId}-${active}` : undefined}
      value={query ?? label(value)} placeholder="Search, e.g. Kolkata"
      onFocus={() => { setOpen(true); setActive(0); }} onChange={e => { setQuery(e.target.value); setOpen(true); setActive(0); }} onKeyDown={key}
      onBlur={() => { blurTimer.current = setTimeout(() => { setOpen(false); setQuery(null); }, 120); }}/>
    <span id={hintId} className={styles.hint}>{accountZone && canonicalZone(accountZone) !== canonicalZone(value) ? `Your account’s zone is ${label(accountZone)}.` : 'Type to search; common zones are listed first.'}</span>
    {open && <ul id={listId} role="listbox" aria-label={text} className={styles.list}>
      {options.length ? options.map((z, i) => <li key={z} id={`${listId}-${i}`} role="option" aria-selected={i === active} className={styles.option}
        onMouseDown={e => { e.preventDefault(); if (blurTimer.current) clearTimeout(blurTimer.current); choose(z); }}>{label(z)}</li>) : <li className={styles.group} role="option" aria-selected={false} aria-disabled="true">No matching time zone</li>}
    </ul>}
  </div>;
}
