// Retainers with monthly quotas (SF-05, owner: WS-05). Pure and isomorphic: the workspace, the
// client page, the statement and the server all fold the same entries the same way.
//
// A retainer scope has `engagement: 'retainer'` and `retainer: {period, quotas, carry_over}`
// (lib/scope.ts). Its ledger records `period_open` (quotas granted, with any carried-over balance),
// `usage` (n units of a quota item) and `period_close` (the period's statement lines). Usage past
// a quota is billed through an automatically proposed change order that carries `overage`.
// The scope fee is the fee for one period.
import type {ChangeOrder, CoStatus, LedgerEntry, PeriodClose, PeriodOpen, Usage} from './ledger';
import {itemsOf, type Scope} from './scope';
import {toMinor} from './minor';
import {pctOfMinor} from './ledger-math';

export type RetainerLine = {item_id: string; title: string; unit: string; quota: number; carried: number; allowance: number; used: number; over: number; left: number};
export type RetainerOverageCo = {seq: number; status: CoStatus; item_id: string; qty: number; fee_delta: number; usage_seq: number};
export type RetainerPeriod = {period: string; starts: string; ends: string; open_seq: number; closed_seq: number | null; lines: RetainerLine[]; overage_cos: RetainerOverageCo[]};
export type RetainerView = {period: 'monthly'; carry_over: 'none' | 'cap'; current: string | null; periods: RetainerPeriod[]};

const r4 = (n: number) => Math.round(n * 10000) / 10000;

/** The calendar month a date falls in ('2026-10-14' → '2026-10'). */
export function periodOf(date: string): string { return date.slice(0, 7); }
/** First and last day of a monthly period. */
export function periodBounds(period: string): {starts: string; ends: string} {
  const [y, m] = period.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return {starts: `${period}-01`, ends: `${period}-${String(last).padStart(2, '0')}`};
}

type CoLike = ChangeOrder & {seq: number; status: CoStatus};

/** Folds the retainer entries of one baseline. `change_orders` are the folded change orders (for overage status). */
export function retainerState(baseline: Scope, entries: LedgerEntry[], change_orders: CoLike[] = []): RetainerView {
  const r = baseline.retainer!;
  const items = new Map(itemsOf(baseline).map(i => [i.id, i]));
  const periods: RetainerPeriod[] = [];
  const byKey = new Map<string, RetainerPeriod>();
  for (const e of entries) {
    if (!e.payload) continue;
    if (e.kind === 'period_open') {
      const p = e.payload as PeriodOpen;
      const view: RetainerPeriod = {
        period: p.period, starts: p.starts, ends: p.ends, open_seq: e.seq, closed_seq: null, overage_cos: [],
        lines: p.quotas.map(q => {
          const item = items.get(q.item_id);
          const allowance = r4(q.qty + q.carried);
          return {item_id: q.item_id, title: item?.title ?? q.item_id, unit: item?.unit ?? '', quota: q.qty, carried: q.carried, allowance, used: 0, over: 0, left: allowance};
        }),
      };
      periods.push(view); byKey.set(p.period, view);
    } else if (e.kind === 'usage') {
      const u = e.payload as Usage;
      const line = byKey.get(u.period)?.lines.find(l => l.item_id === u.item_id);
      if (!line) continue;
      line.used = r4(line.used + u.qty);
      line.over = r4(Math.max(0, line.used - line.allowance));
      line.left = r4(Math.max(0, line.allowance - line.used));
    } else if (e.kind === 'period_close') {
      const view = byKey.get((e.payload as PeriodClose).period);
      if (view) view.closed_seq = e.seq;
    }
  }
  for (const co of change_orders) {
    if (!co.overage) continue;
    byKey.get(co.overage.period)?.overage_cos.push({seq: co.seq, status: co.status, item_id: co.overage.item_id, qty: co.overage.qty, fee_delta: co.fee_delta, usage_seq: co.overage.usage_seq});
  }
  return {period: r.period, carry_over: r.carry_over, current: periods.at(-1)?.period ?? null, periods};
}

/** The quotas a new period grants, with the carry-over from the period before it. */
export function openingQuotas(baseline: Scope, state: RetainerView, period: string): PeriodOpen['quotas'] {
  const r = baseline.retainer!;
  const previous = [...state.periods].reverse().find(p => p.period < period);
  return r.quotas.map(q => {
    const prev = previous?.lines.find(l => l.item_id === q.item_id);
    const carried = r.carry_over === 'cap' && prev ? r4(Math.min(prev.left, q.qty)) : 0;
    return {item_id: q.item_id, qty: q.qty, carried};
  });
}

/** How many of `qty` new units go past the allowance (0 while within quota). One overage event per usage entry. */
export function overageOf(state: RetainerView, usage: Pick<Usage, 'period' | 'item_id' | 'qty'>): number {
  const line = state.periods.find(p => p.period === usage.period)?.lines.find(l => l.item_id === usage.item_id);
  if (!line) return 0;
  const before = Math.max(0, line.used - line.allowance);
  const after = Math.max(0, line.used + usage.qty - line.allowance);
  return r4(after - before);
}

/** The lines a `period_close` entry records. */
export function closingLines(state: RetainerView, period: string): PeriodClose['lines'] {
  const p = state.periods.find(x => x.period === period);
  return (p?.lines ?? []).map(l => ({item_id: l.item_id, quota: l.quota, carried: l.carried, used: l.used, over: l.over, carry_out: l.left}));
}

export type RetainerStatement = {
  period: string; starts: string; ends: string; closed: boolean; currency: string;
  retainer_fee_minor: number;
  lines: (RetainerLine & {usage: {seq: number; date: string; qty: number; note: string}[]})[];
  overage: {seq: number; title: string; status: CoStatus; item_id: string; qty: number; fee_delta_minor: number}[];
  overage_approved_minor: number; overage_pending_minor: number;
  subtotal_minor: number;
  tax: {label: string; pct: number; amount_minor: number};
  total_incl_tax_minor: number;
};

/**
 * Monthly retainer statement data (SF-05; WS-03 renders it as a statement and invoice). The
 * subtotal is the period fee plus approved overage change orders; tax uses the scope's rate.
 */
export function retainerStatement(baseline: Scope, entries: LedgerEntry[], change_orders: CoLike[], period: string): RetainerStatement | null {
  if (baseline.engagement !== 'retainer' || !baseline.retainer) return null;
  const state = retainerState(baseline, entries, change_orders);
  const p = state.periods.find(x => x.period === period);
  if (!p) return null;
  const cur = baseline.currency;
  const usage = entries.filter(e => e.kind === 'usage' && e.payload && (e.payload as Usage).period === period);
  const overage = p.overage_cos.map(o => ({seq: o.seq, title: change_orders.find(c => c.seq === o.seq)?.title ?? `CO-${o.seq}`, status: o.status, item_id: o.item_id, qty: o.qty, fee_delta_minor: toMinor(o.fee_delta, cur)}));
  const approved = overage.filter(o => o.status === 'approved').reduce((s, o) => s + o.fee_delta_minor, 0);
  const pending = overage.filter(o => o.status === 'proposed').reduce((s, o) => s + o.fee_delta_minor, 0);
  const fee = toMinor(baseline.fee, cur);
  const subtotal = fee + approved;
  const pct = baseline.tax_pct ?? 0;
  const tax = pct ? pctOfMinor(subtotal, pct) : 0;
  return {
    period: p.period, starts: p.starts, ends: p.ends, closed: p.closed_seq !== null, currency: cur,
    retainer_fee_minor: fee,
    lines: p.lines.map(l => ({...l, usage: usage.filter(e => (e.payload as Usage).item_id === l.item_id).map(e => { const u = e.payload as Usage; return {seq: e.seq, date: u.date, qty: u.qty, note: u.note}; })})),
    overage, overage_approved_minor: approved, overage_pending_minor: pending,
    subtotal_minor: subtotal,
    tax: {label: baseline.tax_label || 'Tax', pct, amount_minor: tax},
    total_incl_tax_minor: subtotal + tax,
  };
}

/** "11/12 posts used" for counters. */
export function counterLabel(line: Pick<RetainerLine, 'used' | 'allowance' | 'title' | 'unit'>): string {
  return `${line.used}/${line.allowance} ${line.unit || line.title} used`;
}
