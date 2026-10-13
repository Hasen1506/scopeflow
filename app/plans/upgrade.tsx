'use client';
import Link from 'next/link';
import {useEffect, useState} from 'react';
import {api} from '../ui';
import {PLANS, PURCHASABLE, type PlanId} from '@/lib/plans';
type Billing = {plan: {id: string; name: string; status: string | null; until: string | null; cap: string; source: string}; checkout_pending: boolean; invoices: {id: string; number: string; amount_minor: number; currency: string; issued: string}[]};
// M13: the signed-in account's plan badge, upgrade buttons and ScopeFlow's invoices to the account.
export default function Upgrade({currency, enabled, localDouble}: {currency: 'INR' | 'USD'; enabled: boolean; localDouble: boolean}) {
  const [b, setB] = useState<Billing | null>(null), [signedIn, setSignedIn] = useState<boolean | null>(null), [interval, setBillEvery] = useState<'month' | 'year'>('month'), [busy, setBusy] = useState(false), [error, setError] = useState('');
  useEffect(() => { api('/api/me').then(async m => { setSignedIn(!!m.signedIn); if (m.signedIn) setB(await api('/api/billing')); }, () => setSignedIn(false)); }, []);
  async function buy(plan: PlanId) {
    setBusy(true); setError('');
    try { const r = await api('/api/billing/checkout', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({plan, interval, currency})}); location.assign(r.url); }
    catch (e) { setError((e as Error).message); setBusy(false); }
  }
  if (signedIn === false) return <p className="fine section-gap"><Link className="help-link" href="/auth/sign-in?return_to=%2Fplans">Sign in</Link> to see your plan or upgrade.</p>;
  if (!b) return null;
  const until = b.plan.until ? ` until ${b.plan.until.slice(0, 10)}` : '';
  return <section className="section-gap" aria-labelledby="h-your-plan">
    <h2 id="h-your-plan">Your plan: <span className="stage-chip" data-testid="plan-badge">{b.plan.name}</span></h2>
    <p className="fine">{b.plan.cap}.{b.plan.status === 'halted' ? ` Your last payment failed; you keep ${b.plan.name}${until} while the payment is retried.` : b.plan.status === 'cancelled' ? ` Cancelled: you keep ${b.plan.name}${until}.` : b.plan.source === 'lapsed' ? ' Your subscription ended, so the account is on Free.' : ''}</p>
    {enabled && <div className="actions">
      <label>Billing<select value={interval} onChange={e => setBillEvery(e.target.value as 'month' | 'year')}><option value="month">Monthly</option><option value="year">Yearly</option></select></label>
      {PURCHASABLE.filter(id => id !== b.plan.id).map(id => <button key={id} className="primary" disabled={busy} onClick={() => void buy(id)}>Upgrade to {PLANS[id].name}</button>)}
    </div>}
    {localDouble && <p className="fine">Test checkout: this server has no billing provider, so a local stand-in takes no money.</p>}
    {error && <p className="error" role="alert">{error}</p>}
    {b.invoices.length > 0 && <><h3>Your ScopeFlow invoices</h3><ul className="bullets">{b.invoices.map(i => <li key={i.id}><Link className="help-link" href={`/plans/invoices/${i.id}`}>{i.number}</Link> · {i.issued.slice(0, 10)} · {(i.amount_minor / 100).toFixed(2)} {i.currency}</li>)}</ul></>}
  </section>;
}
