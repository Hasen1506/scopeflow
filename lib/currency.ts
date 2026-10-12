import {currencies as configured} from '../config/currencies';
import {exponentOf, fromMinor, toMinor, type Minor} from './minor';

// PR C: the currency list comes from config/currencies.ts (ISO 4217 code, formatting locale,
// display name). Amounts are formatted in each currency's own locale, so INR shows lakh grouping
// (₹1,80,000.00) and JPY has no minor unit, instead of every amount in en-US.

// WS-01 (M4): the number of decimals shown is the currency's ISO 4217 exponent (config/currencies.ts),
// and the amount is rounded to it exactly (half-up on the decimal text, never on a binary float), so
// a yen amount never shows ¥333.33 and a rupee amount never shows ₹0.004999.
export type CurrencyInfo = {code: string; locale: string; name: string; exponent: number};
export const currencyList: CurrencyInfo[] = configured;
const byCode = new Map(currencyList.map(c => [c.code, c]));
/** Every configured code; the scope schema accepts exactly these. */
export const currencyCodes = currencyList.map(c => c.code) as [string, ...string[]];
export function currencyInfo(code: string): CurrencyInfo | undefined { return byCode.get(code); }

const formatters = new Map<string, Intl.NumberFormat>();
/** Locale-aware money: the currency's configured locale unless one is given. Unknown codes fall back to plain numbers. */
export function formatMoney(amount: number, currency: string, locale?: string) {
  const loc = locale ?? byCode.get(currency)?.locale ?? 'en-US';
  const digits = exponentOf(currency);
  const key = loc + '|' + currency;
  let f = formatters.get(key);
  if (!f) {
    try { f = new Intl.NumberFormat(loc, {style: 'currency', currency, minimumFractionDigits: digits, maximumFractionDigits: digits}); }
    catch { f = new Intl.NumberFormat('en-US', {minimumFractionDigits: digits, maximumFractionDigits: digits}); }
    formatters.set(key, f);
  }
  // Round exactly first; Intl would otherwise round the binary value (1.005 → "1.00").
  let value = amount;
  try { value = fromMinor(toMinor(amount, currency), currency); } catch { /* not finite or out of range: let Intl format it */ }
  return f.format(value);
}
/** An amount in minor units, formatted like formatMoney ("¥1,800", "₹29,500.00"). */
export function formatMinor(minor: Minor, currency: string, locale?: string) {
  return formatMoney(fromMinor(minor, currency), currency, locale);
}
