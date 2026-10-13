// Client-page message catalogs (SF-09, owner: WS-07). en is the source; hi and ta must carry the
// same keys and placeholders (tests/property/ws-07-i18n.test.mjs).
import en from '../../messages/en.json';
import hi from '../../messages/hi.json';
import ta from '../../messages/ta.json';
import {makeTranslator, type Catalog, type Lang, type Translate} from './core';

export * from './core';

export const CATALOGS: Record<Lang, Catalog> = {en, hi, ta};

const cache = new Map<Lang, Translate>();
/** The translator for `lang` (memoised; catalogs are static). */
export function translator(lang: Lang): Translate {
  let t = cache.get(lang);
  if (!t) { t = makeTranslator(CATALOGS, lang); cache.set(lang, t); }
  return t;
}
/** English, for code paths that have no language (keeps today's wording). */
export const tEn: Translate = (key, vars) => translator('en')(key, vars);
