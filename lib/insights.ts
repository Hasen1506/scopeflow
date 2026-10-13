import type {Agreement} from './ledger';
import {formatMoney} from './currency';
import {invoiceStatuses, type InvoiceFigures} from './invoice-status';

// Cross-project patterns from the creator's own records. Money is grouped by
// currency because projects can be priced in different currencies.

/** A payment fact (tax-inclusive, refunds negative) on the date the money moved. */
export type PaymentFact = {date: string; amount: number};
export type InvoiceFact = InvoiceFigures & {issued: string};
/**
 * One project's record. The money and flow facts (SF-16) are optional so callers that only have the agreement
 * (MCP, older tests) get exactly the insights they always did; missing facts count as nothing.
 */
export type ProjectAgreement = {
  project_id: string; title: string; client: string; agreement: Agreement;
  /** Date the first baseline was approved (YYYY-MM-DD); used by the period filter. */
  approved_at?: string;
  /** Tax rate of the current baseline: payments are tax-inclusive, change-order values are not. */
  tax_pct?: number;
  /** Tax-inclusive agreed total now (fee incl. approved change orders). */
  total?: number;
  payments?: PaymentFact[];
  invoices?: InvoiceFact[];
  /** MSMED payment days when the scope carries MSMED terms (agreed, or the statutory 15), else null. */
  msmed_days?: number | null;
  /** The scope says the client deducts TDS, so a TDS certificate is expected once money arrives. */
  tds?: boolean;
  /** INR per unit of the scope's currency from the scope's locked FX rate, when it locks one to INR. */
  fx_inr?: number | null;
  radar?: {catches: number; acted: number};
};
type Money = Record<string, number>;
export type ClientInsight = {client: string; projects: number; change_orders: number; approved_change_orders: number; added_value: Money; goodwill: Money; rounds_over: number; days_late: number};
export type Insights = {
  projects: number;
  fee_at_approval: Money; fee_now: Money; change_order_value: Money; goodwill_value: Money; goodwill_hours: number;
  change_orders: {proposed: number; approved: number; declined: number; withdrawn: number; approval_rate: number | null};
  revision_rounds: {included: number; used: number; projects_over: number; average_used: number | null; average_included: number | null};
  client_delays: {count: number; days: number};
  /** Scope creep caught: out-of-scope work turned into change orders, by outcome (fee increases only; withdrawn ones are left out). */
  creep: {requests: number; caught: Money; approved: Money; declined: Money; pending: Money};
  clients: ClientInsight[];
  observations: string[];
  /** SF-16 hero: approved change-order value actually received (payments go to the base fee first). */
  recovered: {total: Money; this_month: Money; last_12: Money; change_orders: number; inr: {value: number; locked: Money; unconverted: Money}};
  money: {received: Money; outstanding: Money; overdue: Money; msmed_overdue: Money; msmed_interest: Money; tds_pending: number};
  flow: {co_latency_days: number | null; radar: {catches: number; acted: number; change_orders: number; approved: number}; rate_card_hit_rate: number | null; retainer_utilisation: number | null};
  /** The last 12 months, oldest first. */
  series: {month: string; change_orders: number; recovered: Money; goodwill: Money}[];
};
export type InsightsOptions = {today?: string; bankRatePct?: number};
/** RBI Bank Rate (per cent) from 7 Oct 2026; MSMED Act s.16 interest is three times it, compounded monthly. */
export const RBI_BANK_RATE_PCT = 5.75;

const add = (m: Money, currency: string, n: number) => { m[currency] = Math.round(((m[currency] ?? 0) + n) * 100) / 100; };

export function computeInsights(rows: ProjectAgreement[], opts: InsightsOptions = {}): Insights {
  const today = opts.today ?? new Date().toISOString().slice(0, 10);
  const out: Insights = {
    projects: rows.length, fee_at_approval: {}, fee_now: {}, change_order_value: {}, goodwill_value: {}, goodwill_hours: 0,
    change_orders: {proposed: 0, approved: 0, declined: 0, withdrawn: 0, approval_rate: null},
    revision_rounds: {included: 0, used: 0, projects_over: 0, average_used: null, average_included: null},
    client_delays: {count: 0, days: 0}, creep: {requests: 0, caught: {}, approved: {}, declined: {}, pending: {}}, clients: [], observations: [],
    recovered: {total: {}, this_month: {}, last_12: {}, change_orders: 0, inr: {value: 0, locked: {}, unconverted: {}}},
    money: {received: {}, outstanding: {}, overdue: {}, msmed_overdue: {}, msmed_interest: {}, tds_pending: 0},
    flow: {co_latency_days: null, radar: {catches: 0, acted: 0, change_orders: 0, approved: 0}, rate_card_hit_rate: null, retainer_utilisation: null},
    series: [],
  };
  const clients = new Map<string, ClientInsight>();
  for (const {client, agreement: a} of rows) {
    const c = a.currency;
    add(out.fee_at_approval, c, a.fee_base);
    add(out.fee_now, c, a.fee);
    add(out.goodwill_value, c, a.goodwill_value);
    out.goodwill_hours += a.goodwill_hours;
    const key = client.trim().toLowerCase();
    const ci = clients.get(key) ?? {client: client.trim(), projects: 0, change_orders: 0, approved_change_orders: 0, added_value: {}, goodwill: {}, rounds_over: 0, days_late: 0};
    ci.projects++;
    for (const co of a.change_orders) {
      out.change_orders[co.status]++;
      if (co.status !== 'withdrawn' && co.fee_delta > 0) {
        out.creep.requests++;
        add(out.creep.caught, c, co.fee_delta);
        add(out.creep[co.status === 'proposed' ? 'pending' : co.status], c, co.fee_delta);
      }
      ci.change_orders++;
      if (co.status === 'approved') { ci.approved_change_orders++; add(out.change_order_value, c, co.fee_delta); add(ci.added_value, c, co.fee_delta); }
    }
    add(ci.goodwill, c, a.goodwill_value);
    out.revision_rounds.included += a.revisions_allowed;
    out.revision_rounds.used += a.revisions_used;
    if (a.rounds_over) out.revision_rounds.projects_over++;
    ci.rounds_over += a.rounds_over;
    for (const d of a.delays) if (d.days_late) { out.client_delays.count++; out.client_delays.days += d.days_late; ci.days_late += d.days_late; }
    clients.set(key, ci);
  }
  const settled = out.change_orders.approved + out.change_orders.declined;
  out.change_orders.approval_rate = settled ? Math.round((out.change_orders.approved / settled) * 100) / 100 : null;
  if (rows.length) {
    out.revision_rounds.average_used = Math.round((out.revision_rounds.used / rows.length) * 10) / 10;
    out.revision_rounds.average_included = Math.round((out.revision_rounds.included / rows.length) * 10) / 10;
  }
  const weight = (c: ClientInsight) => c.change_orders * 2 + c.rounds_over * 2 + Object.values(c.goodwill).filter(v => v > 0).length + (c.days_late ? 1 : 0);
  out.clients = [...clients.values()].sort((a, b) => weight(b) - weight(a) || b.projects - a.projects);

  const o = out.observations, r = out.revision_rounds;
  if (rows.length >= 2 && r.average_used !== null && r.average_included !== null && r.average_used > r.average_included)
    o.push(`Clients use ${r.average_used} revision rounds on average but you include ${r.average_included}. Consider pricing in another round.`);
  if (r.projects_over) o.push(`${r.projects_over} of ${rows.length} projects went over their revision allowance.`);
  for (const [currency, value] of Object.entries(out.creep.caught)) if (value > 0) {
    const approved = out.creep.approved[currency] ?? 0, declined = out.creep.declined[currency] ?? 0;
    o.push(`Scope creep caught: ${formatMoney(value, currency)} of extra work was put to clients as change orders; ${formatMoney(approved, currency)} was approved and billed${declined ? `, ${formatMoney(declined, currency)} declined (so not done for free)` : ''}.`);
  }
  for (const [currency, value] of Object.entries(out.goodwill_value)) if (value > 0) o.push(`You absorbed ${formatMoney(value, currency)} of goodwill work${out.goodwill_hours ? ` (${out.goodwill_hours}h)` : ''}.`);
  if (out.client_delays.count) o.push(`Late client inputs moved delivery dates by ${out.client_delays.days} days in total.`);
  const repeat = out.clients.find(c => c.projects > 1 && c.change_orders + c.rounds_over >= c.projects);
  if (repeat) o.push(`${repeat.client} has needed change orders or extra rounds on most of their projects. Scope their next project more tightly.`);
  extend(out, rows, today, opts.bankRatePct ?? RBI_BANK_RATE_PCT);
  return out;
}

// ---------------------------------------------------------------------------------------------------
// SF-16 (WS-09): money, flow and time. Pure; the route gathers the facts.
// ---------------------------------------------------------------------------------------------------
const r2 = (n: number) => Math.round(n * 100) / 100;
const dayMs = 86400_000;
const days = (from: string, to: string) => (Date.parse(to.slice(0, 10) + 'T00:00:00Z') - Date.parse(from.slice(0, 10) + 'T00:00:00Z')) / dayMs;
/** The 12 months ending with `today`'s, oldest first, as YYYY-MM. */
export function lastMonths(today: string, n = 12): string[] {
  const y = Number(today.slice(0, 4)), m = Number(today.slice(5, 7)) - 1;
  return Array.from({length: n}, (_, i) => { const d = new Date(Date.UTC(y, m - (n - 1 - i), 1)); return d.toISOString().slice(0, 7); });
}
const median = (xs: number[]) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b), h = s.length >> 1; return Math.round((s.length % 2 ? s[h] : (s[h - 1] + s[h]) / 2) * 10) / 10; };

/**
 * Change-order money recovered on one project: payments (net of refunds, tax taken out) are applied to
 * the base fee first and then to approved fee-increasing change orders in the order they were approved,
 * so a change order counts as recovered only once the money for it has actually arrived.
 */
export function recoveredOf(p: Pick<ProjectAgreement, 'agreement' | 'payments' | 'tax_pct'>): {events: {date: string; value: number}[]; total: number; change_orders: number} {
  const cos = p.agreement.change_orders.filter(c => c.status === 'approved' && c.fee_delta > 0).sort((a, b) => (a.settled_at ?? a.created).localeCompare(b.settled_at ?? b.created) || a.seq - b.seq);
  const coSum = r2(cos.reduce((t, c) => t + c.fee_delta, 0));
  if (!coSum || !p.payments?.length) return {events: [], total: 0, change_orders: 0};
  const base = r2(p.agreement.fee - coSum), div = 1 + (p.tax_pct ?? 0) / 100;
  let cum = 0, prev = 0;
  const events: {date: string; value: number}[] = [];
  for (const pay of [...p.payments].sort((a, b) => a.date.localeCompare(b.date))) {
    cum += pay.amount / div;
    const rec = r2(Math.min(coSum, Math.max(0, cum - base)));
    if (rec !== prev) events.push({date: pay.date, value: r2(rec - prev)});
    prev = rec;
  }
  let covered = 0, count = 0;
  for (const c of cos) { covered = r2(covered + c.fee_delta); if (covered <= prev + 0.005) count++; }
  return {events, total: prev, change_orders: count};
}

/** MSMED Act s.16 interest estimate: three times the RBI Bank Rate, compounded monthly, on `open` for `late` days. */
export function msmedInterest(open: number, late: number, bankRatePct = RBI_BANK_RATE_PCT): number {
  if (!(open > 0) || !(late > 0)) return 0;
  return r2(open * (Math.pow(1 + (3 * bankRatePct) / 100 / 12, late / (365 / 12)) - 1));
}

function extend(out: Insights, rows: ProjectAgreement[], today: string, bankRatePct: number) {
  const months = lastMonths(today), first = months[0], thisMonth = months[months.length - 1];
  const series = new Map(months.map(m => [m, {month: m, change_orders: 0, recovered: {} as Money, goodwill: {} as Money}]));
  const latency: number[] = [];
  for (const p of rows) {
    const a = p.agreement, c = a.currency;
    const rec = recoveredOf(p);
    out.recovered.change_orders += rec.change_orders;
    if (rec.total) add(out.recovered.total, c, rec.total);
    for (const e of rec.events) {
      const m = e.date.slice(0, 7);
      if (m === thisMonth) add(out.recovered.this_month, c, e.value);
      if (m >= first && m <= thisMonth) {
        add(out.recovered.last_12, c, e.value);
        add(series.get(m)!.recovered, c, e.value);
        if (c === 'INR') out.recovered.inr.value = r2(out.recovered.inr.value + e.value);
        else if (p.fx_inr) { out.recovered.inr.value = r2(out.recovered.inr.value + e.value * p.fx_inr); add(out.recovered.inr.locked, c, e.value); }
        else add(out.recovered.inr.unconverted, c, e.value);
      }
    }
    for (const co of a.change_orders) {
      const s = series.get(co.created.slice(0, 7));
      if (s && co.status !== 'withdrawn') s.change_orders++;
      if ((co.status === 'approved' || co.status === 'declined') && co.settled_at) latency.push(Math.max(0, days(co.created, co.settled_at)));
    }
    for (const g of a.goodwill) { const s = series.get(g.created.slice(0, 7)); if (s) add(s.goodwill, c, g.value); }

    const received = r2((p.payments ?? []).reduce((t, x) => t + x.amount, 0));
    if (p.payments?.length) add(out.money.received, c, received);
    if (p.total !== undefined) { const left = r2(Math.max(0, p.total - received)); if (left) add(out.money.outstanding, c, left); }
    if (p.invoices?.length) {
      const msmed = p.msmed_days ?? null;
      const figures = p.invoices.map(i => {
        if (msmed === null) return i;
        const statutory = new Date(Date.parse(i.issued.slice(0, 10) + 'T00:00:00Z') + msmed * dayMs).toISOString().slice(0, 10);
        return {...i, due: statutory < i.due ? statutory : i.due};
      });
      for (const st of invoiceStatuses(figures, received, today)) if (st.overdue) {
        add(out.money.overdue, c, st.open);
        if (msmed !== null) { add(out.money.msmed_overdue, c, st.open); const i = msmedInterest(st.open, st.days_overdue, bankRatePct); if (i) add(out.money.msmed_interest, c, i); }
      }
    }
    if (p.tds && received > 0) out.money.tds_pending++;
    if (p.radar) { out.flow.radar.catches += p.radar.catches; out.flow.radar.acted += p.radar.acted; }
  }
  out.flow.co_latency_days = median(latency);
  out.flow.radar.change_orders = out.change_orders.proposed + out.change_orders.approved + out.change_orders.declined;
  out.flow.radar.approved = out.change_orders.approved;
  out.series = [...series.values()];
  for (const [cur, v] of Object.entries(out.recovered.last_12)) if (v > 0) out.observations.push(`Recovered from change orders in the last 12 months: ${formatMoney(v, cur)}${out.recovered.this_month[cur] ? `, ${formatMoney(out.recovered.this_month[cur], cur)} of it this month` : ''}.`);
}

/**
 * One project's agreement across every approved baseline (C4 family): change orders, goodwill, rounds and
 * late inputs recorded under an earlier baseline still count after a supersede. Fees: at approval is the
 * first baseline's, now is the latest's. `baselines` are oldest first.
 */
export function mergeBaselines(baselines: Agreement[]): Agreement {
  if (baselines.length <= 1) return baselines[0];
  const first = baselines[0], last = baselines[baselines.length - 1];
  const sum = (f: (a: Agreement) => number) => baselines.reduce((t, a) => t + f(a), 0);
  return {
    ...last,
    fee_base: first.fee_base,
    change_orders: baselines.flatMap(a => a.change_orders), pending: sum(a => a.pending),
    goodwill: baselines.flatMap(a => a.goodwill), goodwill_value: r2(sum(a => a.goodwill_value)), goodwill_hours: sum(a => a.goodwill_hours),
    revisions_allowed: sum(a => a.revisions_allowed), revisions_used: sum(a => a.revisions_used), rounds_over: sum(a => a.rounds_over),
    delays: baselines.flatMap(a => a.delays),
  };
}

export type InsightsFilter = {period?: 'all' | 'month' | '12m' | 'fy'; client?: string; currency?: string};
/** Projects in a filter. The period is by first approval date; the Indian financial year starts 1 April. */
export function filterProjects(rows: ProjectAgreement[], f: InsightsFilter, today: string): ProjectAgreement[] {
  const period = f.period ?? 'all';
  const from = period === 'month' ? today.slice(0, 7) + '-01' : period === '12m' ? lastMonths(today)[0] + '-01'
    : period === 'fy' ? `${Number(today.slice(5, 7)) >= 4 ? today.slice(0, 4) : Number(today.slice(0, 4)) - 1}-04-01` : '';
  const client = f.client?.trim().toLowerCase();
  return rows.filter(r => (!from || (!!r.approved_at && r.approved_at.slice(0, 10) >= from)) && (!client || r.client.trim().toLowerCase() === client) && (!f.currency || r.agreement.currency === f.currency));
}
export function filterOptions(rows: ProjectAgreement[]) {
  const clients = new Map<string, string>();
  for (const r of rows) { const k = r.client.trim().toLowerCase(); if (!clients.has(k)) clients.set(k, r.client.trim()); }
  return {clients: [...clients.values()].sort((a, b) => a.localeCompare(b)), currencies: [...new Set(rows.map(r => r.agreement.currency))].sort()};
}

/** CSV export of the insights: one metric per row (section, metric, currency, value), then clients and months. */
export function insightsCsv(i: Insights): string {
  // Text cells that a spreadsheet would run as a formula get a leading apostrophe; numbers are left alone.
  const q = (v: string | number) => { if (typeof v === 'number') return String(v); const t = /^[=+\-@\t]/.test(v) ? "'" + v : v; return /[",\n\r']/.test(t) ? '"' + t.replaceAll('"', '""') + '"' : t; };
  const rows: (string | number)[][] = [['section', 'metric', 'currency', 'value']];
  const money = (section: string, metric: string, m: Money) => { for (const [c, v] of Object.entries(m)) rows.push([section, metric, c, v]); };
  money('recovered', 'last_12_months', i.recovered.last_12); money('recovered', 'this_month', i.recovered.this_month); money('recovered', 'all_time', i.recovered.total);
  rows.push(['recovered', 'change_orders_recovered', '', i.recovered.change_orders]);
  money('agreements', 'fee_at_approval', i.fee_at_approval); money('agreements', 'fee_now', i.fee_now); money('agreements', 'change_order_value', i.change_order_value);
  money('creep', 'caught', i.creep.caught); money('creep', 'approved', i.creep.approved); money('creep', 'declined', i.creep.declined);
  money('goodwill', 'value', i.goodwill_value); rows.push(['goodwill', 'hours', '', i.goodwill_hours]);
  rows.push(['revision_rounds', 'average_used', '', i.revision_rounds.average_used ?? ''], ['revision_rounds', 'average_included', '', i.revision_rounds.average_included ?? ''], ['revision_rounds', 'projects_over', '', i.revision_rounds.projects_over]);
  money('money', 'received', i.money.received); money('money', 'outstanding', i.money.outstanding); money('money', 'overdue', i.money.overdue); money('money', 'msmed_interest_estimate', i.money.msmed_interest);
  rows.push(['money', 'tds_certificates_pending', '', i.money.tds_pending], ['flow', 'co_approval_latency_median_days', '', i.flow.co_latency_days ?? ''], ['flow', 'radar_catches', '', i.flow.radar.catches], ['flow', 'change_orders_approved', '', i.flow.radar.approved]);
  for (const c of i.clients) rows.push(['client', c.client, '', `${c.projects} projects; ${c.change_orders} change orders (${c.approved_change_orders} approved); ${c.rounds_over} rounds over; ${c.days_late} days late`]);
  for (const s of i.series) { rows.push(['month', s.month + ' change_orders', '', s.change_orders]); money('month', s.month + ' recovered', s.recovered); money('month', s.month + ' goodwill', s.goodwill); }
  return rows.map(r => r.map(q).join(',')).join('\r\n') + '\r\n';
}
