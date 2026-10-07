import type {Agreement} from './ledger';
import {formatMoney} from './currency';

// Cross-project patterns from the creator's own records. Money is grouped by
// currency because projects can be priced in different currencies.

export type ProjectAgreement = {project_id: string; title: string; client: string; agreement: Agreement};
type Money = Record<string, number>;
export type ClientInsight = {client: string; projects: number; change_orders: number; approved_change_orders: number; added_value: Money; goodwill: Money; rounds_over: number; days_late: number};
export type Insights = {
  projects: number;
  fee_at_approval: Money; fee_now: Money; change_order_value: Money; goodwill_value: Money; goodwill_hours: number;
  change_orders: {proposed: number; approved: number; declined: number; withdrawn: number; approval_rate: number | null};
  revision_rounds: {included: number; used: number; projects_over: number; average_used: number | null; average_included: number | null};
  client_delays: {count: number; days: number};
  clients: ClientInsight[];
  observations: string[];
};

const add = (m: Money, currency: string, n: number) => { m[currency] = Math.round(((m[currency] ?? 0) + n) * 100) / 100; };

export function computeInsights(rows: ProjectAgreement[]): Insights {
  const out: Insights = {
    projects: rows.length, fee_at_approval: {}, fee_now: {}, change_order_value: {}, goodwill_value: {}, goodwill_hours: 0,
    change_orders: {proposed: 0, approved: 0, declined: 0, withdrawn: 0, approval_rate: null},
    revision_rounds: {included: 0, used: 0, projects_over: 0, average_used: null, average_included: null},
    client_delays: {count: 0, days: 0}, clients: [], observations: [],
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
  for (const [currency, value] of Object.entries(out.change_order_value)) if (value > 0) o.push(`Change orders added ${formatMoney(value, currency)} that would otherwise have been unbilled.`);
  for (const [currency, value] of Object.entries(out.goodwill_value)) if (value > 0) o.push(`You absorbed ${formatMoney(value, currency)} of goodwill work${out.goodwill_hours ? ` (${out.goodwill_hours}h)` : ''}.`);
  if (out.client_delays.count) o.push(`Late client inputs moved delivery dates by ${out.client_delays.days} days in total.`);
  const repeat = out.clients.find(c => c.projects > 1 && c.change_orders + c.rounds_over >= c.projects);
  if (repeat) o.push(`${repeat.client} has needed change orders or extra rounds on most of their projects. Scope their next project more tightly.`);
  return out;
}
