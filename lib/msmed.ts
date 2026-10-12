import {z} from 'zod';
import type {Minor} from './contracts';
import {RBI_BANK_RATE} from '../config/rbi-bank-rate';

// WS-03 (SF-07): MSMED Act 2006 payment terms and interest, plan §9.1 rows 1–4. Pure.
//
//  s.15  The buyer pays on or before the date agreed in writing, which may not exceed 45 days from
//        the day of acceptance or deemed acceptance; with no agreement, before the appointed day.
//  s.2(b) Appointed day = the day after 15 days from acceptance or deemed acceptance. Deemed
//        acceptance = the day of delivery, when no written objection is made within 15 days of it.
//        An objection within 15 days moves acceptance to the day the objection is removed.
//  s.16  Compound interest with monthly rests at three times the Bank Rate notified by the RBI, from
//        the appointed day (or the day after the agreed date) until payment, notwithstanding any agreement.
//  s.2(n) "Supplier" is a micro or small enterprise that has filed its memorandum (Udyam): medium
//        enterprises are excluded. Registration after the contract: Silpi (SC 2021) / Mahakali (SC 2022)
//        say no benefit for supplies under earlier contracts; NBCC (2025 INSC 54) referred the question
//        to a larger bench, still pending.
// Source: https://samadhaan.msme.gov.in/WriteReadData/DocumentFile/MSMED2006act.pdf
// Everything here is an estimate pending CA/lawyer review: in particular which Bank Rate applies over a
// long delay (the rate on the appointed day, our default, or each period's own rate) and the day count.

/** Dated RBI Bank Rate table (config/rbi-bank-rate.ts): every function takes it as an argument, defaulting to it. */
export {RBI_BANK_RATE};
export type BankRateTable = readonly {from: string; rate: number; source: string}[];

/** The Bank Rate in force on `day`, or null when the table does not reach back that far. */
export function bankRateOn(day: string, table: BankRateTable = RBI_BANK_RATE): {rate: number; from: string; source: string} | null {
  let hit: BankRateTable[number] | null = null;
  for (const r of table) if (r.from <= day) hit = r;
  return hit;
}

export const MSME_CATEGORIES = ['micro', 'small', 'medium'] as const;
export type MsmeCategory = (typeof MSME_CATEGORIES)[number];
export const msmeProfileSchema = z.object({
  udyam_number: z.string().trim().toUpperCase().regex(/^UDYAM-[A-Z]{2}-\d{2}-\d{7}$/, 'Udyam numbers look like UDYAM-TN-02-0012345'),
  registered_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  category: z.enum(MSME_CATEGORIES),
}).strict();
export type MsmeProfile = z.infer<typeof msmeProfileSchema>;
export const RATE_BASES = ['on_due_date', 'per_period'] as const;
export type RateBasis = (typeof RATE_BASES)[number];

export const addDays = (day: string, n: number) => new Date(Date.parse(day + 'T00:00:00Z') + n * 86400_000).toISOString().slice(0, 10);
const daysBetween = (from: string, to: string) => Math.round((Date.parse(to + 'T00:00:00Z') - Date.parse(from + 'T00:00:00Z')) / 86400_000);

export type Acceptance = {delivered_on: string; accepted_on?: string | null; objection_on?: string | null; objection_removed_on?: string | null};
/**
 * The day of acceptance under s.2(b): written acceptance; an objection made within 15 days of delivery
 * moves it to the day the objection is removed (null while it is open); otherwise, once 15 days have
 * passed with no objection, the delivery day itself (deemed acceptance). `today` decides whether the
 * 15 days have passed. Pure.
 */
export function acceptanceDay(a: Acceptance, today: string): {day: string | null; basis: 'accepted' | 'deemed' | 'objection_removed' | 'objection_open' | 'pending'} {
  const objected = a.objection_on && daysBetween(a.delivered_on, a.objection_on) <= 15;
  if (objected) return a.objection_removed_on ? {day: a.objection_removed_on, basis: 'objection_removed'} : {day: null, basis: 'objection_open'};
  if (a.accepted_on) return {day: a.accepted_on, basis: 'accepted'};
  if (daysBetween(a.delivered_on, today) > 15) return {day: a.delivered_on, basis: 'deemed'};
  return {day: null, basis: 'pending'};
}
/** Last day to pay (s.15) and the first day interest runs (s.16). `agreed_days` is the written term (at most 45). */
export function msmedDueDates(acceptance: string, agreed_days?: number | null) {
  const days = agreed_days ? Math.min(45, agreed_days) : 15;
  const pay_by = addDays(acceptance, days);
  return {pay_by, interest_from: addDays(pay_by, 1), agreed: !!agreed_days};
}

export type InterestPeriod = {from: string; to: string; days: number; opening: Minor; rates: {from: string; rate_pa: number; days: number}[]; interest: Minor; closing: Minor};
export type InterestResult = {principal: Minor; interest_from: string; paid_on: string; rate_basis: RateBasis; periods: InterestPeriod[]; interest: Minor; total: Minor; covered: boolean; note: string};

/** round(n / d) half up, d > 0, n >= 0. */
const divRound = (n: bigint, d: bigint) => { const q = n / d, r = n % d; return r * BigInt(2) >= d ? q + BigInt(1) : q; };

/**
 * s.16 interest on `principal` (minor units) from `interest_from` until `paid_on` (the payment day
 * itself carries no interest). Compound with monthly rests: the interest of each month (from the same
 * day-of-month as interest_from) is added to the balance at the rest. Within a period interest is
 * daily, at 3 × the Bank Rate / 365, rounded half up to the minor unit at each rest. `rate_basis`:
 * 'on_due_date' (default) uses the Bank Rate on interest_from throughout; 'per_period' uses each day's
 * own rate. `covered` is false when the rate table does not reach back to a day that needs it.
 */
export function msmedInterest({principal, interest_from, paid_on, rate_basis = 'on_due_date', table = RBI_BANK_RATE}: {principal: Minor; interest_from: string; paid_on: string; rate_basis?: RateBasis; table?: BankRateTable}): InterestResult {
  const base = {principal, interest_from, paid_on, rate_basis, note: 'Estimate based on the rules as we understand them; confirm with your CA.'};
  if (!(principal > 0) || paid_on <= interest_from) return {...base, periods: [], interest: 0, total: principal, covered: true};
  const fixed = bankRateOn(interest_from, table);
  const rateFor = (day: string) => (rate_basis === 'on_due_date' ? fixed : bankRateOn(day, table));
  let covered = !!fixed, balance = BigInt(principal);
  const periods: InterestPeriod[] = [];
  const [y0, m0, d0] = interest_from.split('-').map(Number);
  for (let k = 1, from = interest_from; from < paid_on; k++) {
    // The k-th monthly rest: same day of month as the start, clamped to the month's last day.
    const y = y0 + Math.floor((m0 - 1 + k) / 12), m = (m0 - 1 + k) % 12 + 1;
    const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const rest = `${y}-${String(m).padStart(2, '0')}-${String(Math.min(d0, last)).padStart(2, '0')}`;
    const to = rest < paid_on ? rest : paid_on;
    // Σ over the days of (3 × Bank Rate) in basis points, grouped by rate for the worksheet.
    const rates: InterestPeriod['rates'] = [];
    let bpDays = BigInt(0);
    for (let d = from; d < to; d = addDays(d, 1)) {
      const r = rateFor(d);
      if (!r) { covered = false; continue; }
      const pa = Math.round(r.rate * 3 * 100) / 100;
      const g = rates.at(-1);
      if (g && g.rate_pa === pa) g.days++; else rates.push({from: d, rate_pa: pa, days: 1});
      bpDays += BigInt(Math.round(pa * 100));
    }
    const interest = divRound(balance * bpDays, BigInt(10000) * BigInt(365));
    const opening = balance;
    balance += interest;
    periods.push({from, to, days: daysBetween(from, to), opening: Number(opening), rates, interest: Number(interest), closing: Number(balance)});
    from = to;
  }
  const interest = Number(balance) - principal;
  return {...base, periods, interest, total: Number(balance), covered};
}

export type MsmedWarning = {code: 'medium_excluded' | 'registered_after_contract' | 'no_udyam' | 'over_45_days' | 'rate_table_gap'; message: string};
/** Warnings for a project: medium enterprises are excluded; registration after the contract may lose the benefit. */
export function msmedWarnings(p: {profile: MsmeProfile | null; contract_date: string | null; agreed_days?: number | null; covered?: boolean}): MsmedWarning[] {
  const out: MsmedWarning[] = [];
  if (!p.profile) out.push({code: 'no_udyam', message: 'Add your Udyam registration (number, date and category) to use MSMED Act terms and interest.'});
  else {
    if (p.profile.category === 'medium') out.push({code: 'medium_excluded', message: 'MSMED Act payment terms and interest (ss.15–16) protect micro and small enterprises only; medium enterprises are excluded.'});
    if (p.contract_date && p.profile.registered_on > p.contract_date.slice(0, 10)) out.push({code: 'registered_after_contract', message: `MSMED benefits may not apply to work agreed before your Udyam registration (registered ${p.profile.registered_on}, agreement approved ${p.contract_date.slice(0, 10)}) (Silpi/Mahakali; NBCC reference pending).`});
  }
  if (p.agreed_days && p.agreed_days > 45) out.push({code: 'over_45_days', message: 'The MSMED Act caps the agreed payment period at 45 days from acceptance.'});
  if (p.covered === false) out.push({code: 'rate_table_gap', message: 'The Bank Rate table does not reach back to the due date; the interest shown is incomplete.'});
  return out;
}
/** Whether MSMED terms apply at all (a micro or small enterprise with Udyam details). */
export const msmedApplies = (profile: MsmeProfile | null) => !!profile && profile.category !== 'medium';

/** The payment clause inserted into the terms for a micro or small supplier. */
export function msmedClause(profile: MsmeProfile, agreed_days?: number | null) {
  const days = agreed_days ? Math.min(45, agreed_days) : null;
  return `The supplier is a ${profile.category} enterprise registered under the MSMED Act, 2006 (Udyam ${profile.udyam_number}). ` +
    (days ? `Payment is due within ${days} days of the day of acceptance (or deemed acceptance) of the work.` : 'Payment is due within 15 days of the day of acceptance (or deemed acceptance) of the work.') +
    ' If payment is late, the buyer is liable under section 16 of the Act to pay compound interest with monthly rests at three times the Bank Rate notified by the Reserve Bank of India.';
}
export const MSMED_DISCLAIMER = 'Estimate — confirm with your CA.';

/** The interest worksheet as CSV (one row per rate segment), for the pack and the CA. */
export function interestCsv(r: InterestResult, currency = 'INR') {
  const m = (v: number) => (v / (currency === 'JPY' ? 1 : 100)).toFixed(currency === 'JPY' ? 0 : 2);
  const rows = ['period_from,period_to,days,opening_balance,rate_pa_pct,rate_days,interest_for_period,closing_balance'];
  for (const p of r.periods) p.rates.forEach((g, i) => rows.push([p.from, p.to, p.days, m(p.opening), g.rate_pa.toFixed(2), g.days, i === p.rates.length - 1 ? m(p.interest) : '', i === p.rates.length - 1 ? m(p.closing) : ''].join(',')));
  rows.push(`total,,,${m(r.principal)},,,${m(r.interest)},${m(r.total)}`);
  return rows.join('\n') + '\n';
}
