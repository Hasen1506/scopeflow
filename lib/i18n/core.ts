// Client-page interface language (SF-09, owner: WS-07). Pure: no React, no catalogs imported here,
// so node tests can import it directly. Only the page chrome is translated; the scope the client
// approves (titles, deliverables, terms, comments, amounts) is always shown exactly as written.

export const LANGS = ['en', 'hi', 'ta'] as const;
export type Lang = (typeof LANGS)[number];
export const DEFAULT_LANG: Lang = 'en';
/** Each language named in its own script, for the picker. */
export const LANG_NAMES: Record<Lang, string> = {en: 'English', hi: 'हिन्दी', ta: 'தமிழ்'};
/** Where the reader's own choice is remembered on this device. */
export const LANG_STORAGE_KEY = 'scopeflow:client-lang';

export type Catalog = Record<string, string>;
export type Vars = Record<string, string | number>;
export type Translate = (key: string, vars?: Vars) => string;

export function isLang(value: unknown): value is Lang {
  return typeof value === 'string' && (LANGS as readonly string[]).includes(value);
}

/** The first supported language in an Accept-Language header, by q-value then order (`ta-IN` → `ta`). */
export function parseAcceptLanguage(header: string | null | undefined): Lang | null {
  if (!header) return null;
  const ranked = header.split(',').map((part, index) => {
    const [tag, ...params] = part.trim().split(';');
    const q = params.map(p => p.trim()).find(p => p.startsWith('q='));
    const weight = q ? Number(q.slice(2)) : 1;
    return {base: tag.trim().toLowerCase().split('-')[0], weight: Number.isFinite(weight) ? weight : 0, index};
  }).filter(r => r.base && r.weight > 0).sort((a, b) => b.weight - a.weight || a.index - b.index);
  for (const r of ranked) if (isLang(r.base)) return r.base;
  return null;
}

/**
 * Which language the client page starts in. An explicit `?lang=` wins, then the reader's own choice
 * remembered on this device, then the language the creator set on the scope, then the browser's
 * Accept-Language, then English. Unsupported values at any step are skipped.
 */
export function pickLang(opts: {query?: unknown; stored?: unknown; scope?: unknown; accept?: string | null}): Lang {
  for (const candidate of [opts.query, opts.stored, opts.scope]) if (isLang(candidate)) return candidate;
  return parseAcceptLanguage(opts.accept) ?? DEFAULT_LANG;
}

/** `{name}` placeholders replaced from `vars`; unknown placeholders are left as written. */
export function interpolate(template: string, vars?: Vars): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (whole, name: string) => (Object.hasOwn(vars, name) ? String(vars[name]) : whole));
}

/** A translator for `lang`: falls back to English for a missing key, then to the key itself. */
export function makeTranslator(catalogs: Record<Lang, Catalog>, lang: Lang): Translate {
  const own = catalogs[lang] ?? catalogs.en, en = catalogs.en;
  return (key, vars) => interpolate(own[key] ?? en[key] ?? key, vars);
}

/** Placeholder names used by a message, sorted (catalog parity checks these too). */
export function placeholders(template: string): string[] {
  return [...template.matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort();
}
