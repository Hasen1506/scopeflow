import {currencies as configured} from '../config/currencies';

// PR C: the currency list comes from config/currencies.ts (ISO 4217 code, formatting locale,
// display name). Amounts are formatted in each currency's own locale, so INR shows lakh grouping
// (₹1,80,000.00) and JPY has no minor unit, instead of every amount in en-US.

export type CurrencyInfo = {code: string; locale: string; name: string};
export const currencyList: CurrencyInfo[] = configured;
const byCode = new Map(currencyList.map(c => [c.code, c]));
/** Every configured code; the scope schema accepts exactly these. */
export const currencyCodes = currencyList.map(c => c.code) as [string, ...string[]];
export function currencyInfo(code: string): CurrencyInfo | undefined { return byCode.get(code); }

const formatters = new Map<string, Intl.NumberFormat>();
/** Locale-aware money: the currency's configured locale unless one is given. Unknown codes fall back to plain numbers. */
export function formatMoney(amount: number, currency: string, locale?: string) {
  const loc = locale ?? byCode.get(currency)?.locale ?? 'en-US';
  const key = loc + '|' + currency;
  let f = formatters.get(key);
  if (!f) {
    try { f = new Intl.NumberFormat(loc, {style: 'currency', currency, maximumFractionDigits: 2}); }
    catch { f = new Intl.NumberFormat('en-US', {maximumFractionDigits: 2}); }
    formatters.set(key, f);
  }
  return f.format(amount);
}
