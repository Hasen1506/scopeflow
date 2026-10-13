'use client';
import {useEffect, useState} from 'react';
import {Download} from 'lucide-react';
import type {Insights} from '@/lib/insights';
import {formatMoney} from '@/lib/scope';
import {api, EmptyState, Skeleton} from './ui';

type Data = Insights & {options?: {clients: string[]; currencies: string[]}};
type Fx = {currency: string; rate: number; as_of: string; source: string} | {currency: string; error: string};
const PERIODS = [['all', 'All time'], ['month', 'This month'], ['12m', 'Last 12 months'], ['fy', 'This financial year']] as const;
const money = (m: Record<string, number>) => Object.entries(m).filter(([, v]) => v).map(([c, v]) => formatMoney(v, c)).join(' + ') || '—';

/** What the ledger shows across all approved agreements: where scope actually moves. SF-16 adds the ₹ recovered hero,
 * money and flow cards, a monthly series, filters and CSV export on top of every earlier card. */
export function InsightsPanel({signedIn}: {signedIn: boolean}) {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState('');
  // SF-16: filters (period, client, currency) re-read the route; the CSV export uses the same query.
  const [period, setPeriod] = useState('all'), [client, setClient] = useState(''), [currency, setCurrency] = useState(''), [inr, setInr] = useState(false), [fx, setFx] = useState<Fx[]>([]);
  const qs = new URLSearchParams({...(period !== 'all' ? {period} : {}), ...(client ? {client} : {}), ...(currency ? {currency} : {})}).toString();
  // UX-C26: a refetch dims the numbers (aria-busy) instead of leaving stale ones looking current; errors offer a retry.
  const [loading, setLoading] = useState(false), [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!signedIn) return;
    let live = true;
    queueMicrotask(() => { if (live) { setLoading(true); setError(''); } });
    api('/api/insights' + (qs ? '?' + qs : '')).then(d => { if (live) setData(d); }, e => { if (live) setError((e as Error).message); }).finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [signedIn, qs, attempt]);
  // INR equivalent: amounts with a locked rate are converted on the server; the rest use today's reference rate, named with its source.
  const unconverted = Object.keys(data?.recovered?.inr.unconverted ?? {}).join(',');
  useEffect(() => {
    if (!inr || !unconverted) return;
    let live = true;
    Promise.all(unconverted.split(',').map(c => api(`/api/fx?from=${c}&to=INR`).then(r => ({currency: c, ...r}) as Fx, e => ({currency: c, error: (e as Error).message}) as Fx))).then(list => { if (live) setFx(list); });
    return () => { live = false; };
  }, [inr, unconverted]);
  if (!signedIn) return <EmptyState title="Patterns across your projects">Sign in to see where scope actually moves: change orders, rounds and goodwill.</EmptyState>;
  if (error) return <p className="error" role="alert">Couldn’t load insights ({error}). <button type="button" className="help-link" onClick={() => setAttempt(n => n + 1)}>Retry</button></p>;
  if (!data) return <Skeleton cards={2} lines={2} label="Loading insights…" />;
  const filtered = !!qs;
  if (!data.projects && !filtered) return <EmptyState title="No approved agreements yet">Insights appear once a client approves a scope and you start recording change orders, rounds and goodwill.</EmptyState>;
  const co = data.change_orders, r = data.revision_rounds, rec = data.recovered, m = data.money, f = data.flow;
  const inrValue = rec ? rec.inr.value + fx.reduce((t, x) => t + ('rate' in x ? (rec.inr.unconverted[x.currency] ?? 0) * x.rate : 0), 0) : 0;
  const filters = <div className="actions insights-filters" role="group" aria-label="Insights filters">
    <label>Period<select value={period} onChange={e => setPeriod(e.target.value)}>{PERIODS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
    {(data.options?.clients.length ?? 0) > 1 && <label>Client<select value={client} onChange={e => setClient(e.target.value)}><option value="">All clients</option>{data.options!.clients.map(c => <option key={c} value={c}>{c}</option>)}</select></label>}
    {(data.options?.currencies.length ?? 0) > 1 && <label>Currency<select value={currency} onChange={e => setCurrency(e.target.value)}><option value="">All currencies</option>{data.options!.currencies.map(c => <option key={c} value={c}>{c}</option>)}</select></label>}
    <a className="secondary" href={'/api/insights?format=csv' + (qs ? '&' + qs : '')} download><Download size={14} aria-hidden="true" />Export CSV</a>
  </div>;
  if (!data.projects) return <div className="section-gap">{filters}<p className="fine">No approved agreements match these filters.</p></div>;
  return (
    <div className={'section-gap insights-body' + (loading ? ' is-loading' : '')} aria-busy={loading || undefined}>
      {filters}
      {rec && <section className={'insights-hero' + (Object.keys(inr ? {} : rec.last_12).length > 1 ? ' multi' : '')} aria-label="Recovered from change orders">
        <span className="eyebrow">{Object.keys(rec.last_12).every(c => c === 'INR') || inr ? '₹ recovered' : 'Recovered'} · last 12 months</span>
        <strong>{inr ? formatMoney(Math.round(inrValue * 100) / 100, 'INR') : money(rec.last_12)}</strong>
        <em>{money(rec.this_month)} this month · {rec.change_orders} change order{rec.change_orders === 1 ? '' : 's'} paid for · {money(rec.total)} all time</em>
        <p className="fine">Approved change-order value the client has actually paid: payments go to the agreed fee first, then to change orders in the order they were approved.</p>
        {Object.keys(rec.last_12).some(c => c !== 'INR') && <p className="fine"><button className="help-link" aria-pressed={inr} onClick={() => setInr(v => !v)}>{inr ? 'Show by currency' : 'Show INR equivalent'}</button>{inr && <> · {Object.keys(rec.inr.locked).length ? `${Object.keys(rec.inr.locked).join(', ')} at the rate locked in the scope` : ''}{fx.map(x => 'rate' in x ? ` ${x.currency} at ${x.rate} (${x.source}, ${x.as_of})` : ` ${x.currency} not converted: ${x.error}`).join(' ·')}</>}</p>}
      </section>}
      <h2>Across {data.projects} approved agreement{data.projects === 1 ? '' : 's'}</h2>
      <div className="agreement-grid">
        <div><span>Fees at approval</span><strong>{money(data.fee_at_approval)}</strong><em>now {money(data.fee_now)}</em></div>
        <div><span>Captured by change orders</span><strong>{money(data.change_order_value)}</strong><em>{co.approved} approved{co.approval_rate !== null ? ` · ${Math.round(co.approval_rate * 100)}% approval` : ''}</em></div>
        <div><span>Scope creep caught</span><strong>{money(data.creep.caught)}</strong><em>{data.creep.requests} request{data.creep.requests === 1 ? '' : 's'} · {money(data.creep.approved)} billed{Object.values(data.creep.declined).some(v => v > 0) ? ` · ${money(data.creep.declined)} declined` : ''}</em></div>
        <div><span>Goodwill absorbed</span><strong>{money(data.goodwill_value)}</strong>{data.goodwill_hours > 0 && <em>{data.goodwill_hours}h</em>}</div>
        <div><span>Revision rounds</span><strong>{r.average_used ?? 0} used / {r.average_included ?? 0} sold</strong><em>per project · {r.projects_over} over</em></div>
      </div>
      {m && f && <>
        <h3 className="section-gap">Money</h3>
        <div className="agreement-grid">
          <div><span>Received</span><strong>{money(m.received)}</strong><em>net of refunds</em></div>
          <div><span>Outstanding</span><strong>{money(m.outstanding)}</strong><em>agreed total not yet received</em></div>
          <div><span>Overdue</span><strong>{money(m.overdue)}</strong><em>{Object.keys(m.msmed_overdue).length ? `${money(m.msmed_overdue)} past the MSMED due date` : 'issued invoices past due'}</em></div>
          <div><span>MSMED interest accrued</span><strong>{money(m.msmed_interest)}</strong><em>estimate · 3× RBI bank rate, monthly rests</em></div>
          <div><span>TDS certificates pending</span><strong>{m.tds_pending}</strong><em>projects with TDS and money received</em></div>
        </div>
        <h3 className="section-gap">Flow</h3>
        <div className="agreement-grid">
          <div><span>Change-order approval time</span><strong>{f.co_latency_days === null ? '—' : `${f.co_latency_days} day${f.co_latency_days === 1 ? '' : 's'}`}</strong><em>median, proposal to decision</em></div>
          <div><span>Radar catches → change orders</span><strong>{f.radar.catches} → {f.radar.change_orders} → {f.radar.approved}</strong><em>out-of-scope emails · proposed · approved</em></div>
          <div><span>Rate-card hit rate</span><strong>{f.rate_card_hit_rate === null ? '—' : `${Math.round(f.rate_card_hit_rate * 100)}%`}</strong><em>{f.rate_card_hit_rate === null ? 'appears once change orders use a rate card' : 'change orders priced from the rate card'}</em></div>
          <div><span>Retainer utilisation</span><strong>{f.retainer_utilisation === null ? '—' : `${Math.round(f.retainer_utilisation * 100)}%`}</strong><em>{f.retainer_utilisation === null ? 'appears once retainer usage is recorded' : 'of monthly quota used'}</em></div>
        </div>
      </>}
      {data.series?.some(x => x.change_orders || Object.keys(x.recovered).length || Object.keys(x.goodwill).length) && <>
        <h3 className="section-gap">By month</h3>
        <div className="table-scroll"><table className="insights-series"><caption className="sr-only">Change orders, money recovered and goodwill by month</caption><thead><tr><th scope="col">Month</th><th scope="col">Change orders</th><th scope="col">Recovered</th><th scope="col">Goodwill</th></tr></thead>
          <tbody>{data.series.filter(x => x.change_orders || Object.keys(x.recovered).length || Object.keys(x.goodwill).length).map(x => <tr key={x.month}><th scope="row">{x.month}</th><td>{x.change_orders}</td><td>{money(x.recovered)}</td><td>{money(x.goodwill)}</td></tr>)}</tbody></table></div>
      </>}
      {data.observations.length > 0 && <ul className="observations">{data.observations.map((o, i) => <li key={i}>{o}</li>)}</ul>}
      <h3 className="section-gap">By client</h3>
      {data.clients.map(c => (
        <div className="history" key={c.client}>
          <strong>{c.client}</strong> <span>{c.projects} project{c.projects === 1 ? '' : 's'} · {c.change_orders} change order{c.change_orders === 1 ? '' : 's'} ({c.approved_change_orders} approved, {money(c.added_value)}) · goodwill {money(c.goodwill)} · {c.rounds_over} round{c.rounds_over === 1 ? '' : 's'} over · {c.days_late} days late inputs</span>
        </div>
      ))}
      <p className="fine">Based only on what you record in each project’s ledger. Private to your account.</p>
    </div>
  );
}
