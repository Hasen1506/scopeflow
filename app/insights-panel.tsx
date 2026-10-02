'use client';
import {useEffect, useState} from 'react';
import type {Insights} from '@/lib/insights';
import {formatMoney} from '@/lib/scope';
import {api} from './ui';

const money = (m: Record<string, number>) => Object.entries(m).filter(([, v]) => v).map(([c, v]) => formatMoney(v, c)).join(' + ') || '—';

/** What the ledger shows across all approved agreements: where scope actually moves. */
export function InsightsPanel({signedIn}: {signedIn: boolean}) {
  const [data, setData] = useState<Insights | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!signedIn) return;
    let live = true;
    api('/api/insights').then(d => { if (live) setData(d); }, e => { if (live) setError((e as Error).message); });
    return () => { live = false; };
  }, [signedIn]);
  if (!signedIn) return <p className="empty">Sign in to see patterns across your projects.</p>;
  if (error) return <p className="error" role="alert">{error}</p>;
  if (!data) return <p className="empty">Loading insights…</p>;
  if (!data.projects) return <p className="empty">Insights appear once a client approves a scope and you start recording change orders, rounds and goodwill.</p>;
  const co = data.change_orders, r = data.revision_rounds;
  return (
    <div className="section-gap">
      <h2>Across {data.projects} approved agreement{data.projects === 1 ? '' : 's'}</h2>
      <div className="agreement-grid">
        <div><span>Fees at approval</span><strong>{money(data.fee_at_approval)}</strong><em>now {money(data.fee_now)}</em></div>
        <div><span>Captured by change orders</span><strong>{money(data.change_order_value)}</strong><em>{co.approved} approved{co.approval_rate !== null ? ` · ${Math.round(co.approval_rate * 100)}% approval` : ''}</em></div>
        <div><span>Goodwill absorbed</span><strong>{money(data.goodwill_value)}</strong>{data.goodwill_hours > 0 && <em>{data.goodwill_hours}h</em>}</div>
        <div><span>Revision rounds</span><strong>{r.average_used ?? 0} used / {r.average_included ?? 0} sold</strong><em>per project · {r.projects_over} over</em></div>
      </div>
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
