'use client';
import Link from 'next/link';
import {useEffect, useState} from 'react';
import {api} from '../ui';
import {PLANS, type PlanCard, type PlanId} from '@/lib/plans';
type Billing = {plan: {id: string; name: string; status: string | null; until: string | null; cap: string; source: string}; checkout_pending: boolean; invoices: {id: string; number: string; amount_minor: number; currency: string; issued: string}[]};
const RECOMMENDED: PlanId = 'pro';
// M13: the signed-in account's plan badge, one action on every plan card, and ScopeFlow's invoices to the account.
// Signed out, each card leads to sign-up with the plan carried along; signed in, paid cards start checkout
// (or say "coming soon" while paid plans are not on sale yet).
export default function Upgrade({currency, enabled, localDouble, cards, chosen, betaName}: {currency: 'INR' | 'USD'; enabled: boolean; localDouble: boolean; cards: PlanCard[]; chosen?: string;
  /** #7: name of the free beta allowance shown above the cards, when accounts without a subscription get it. */ betaName?: string}) {
  const [b, setB] = useState<Billing | null>(null), [signedIn, setSignedIn] = useState<boolean | null>(null), [interval, setBillEvery] = useState<'month' | 'year'>('month'), [busy, setBusy] = useState(false), [error, setError] = useState('');
  useEffect(() => { api('/api/me').then(async m => { setSignedIn(!!m.signedIn); if (m.signedIn) setB(await api('/api/billing')); }, () => setSignedIn(false)); }, []);
  async function buy(plan: PlanId) {
    setBusy(true); setError('');
    try { const r = await api('/api/billing/checkout', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({plan, interval, currency})}); location.assign(r.url); }
    catch (e) { setError((e as Error).message); setBusy(false); }
  }
  const signUpHref = (id: PlanId) => `/auth/sign-up?plan=${id}&return_to=${encodeURIComponent(`/plans?plan=${id}${currency === 'USD' ? '&currency=USD' : ''}`)}`;
  function action(c: PlanCard) {
    const primary = c.id === RECOMMENDED ? 'primary' : 'secondary';
    if (signedIn === null || (signedIn && !b)) return <span className="plan-action-placeholder" aria-hidden="true"/>;
    // R3-16: during the beta a new account starts on the beta allowance, not on Free, so the button says so.
    if (!signedIn) return <Link className={primary} href={signUpHref(c.id)}>{c.purchasable ? `Choose ${c.name}` : betaName ? 'Start free (beta)' : 'Start free'}</Link>;
    if (b!.plan.id === c.id) return <button type="button" className="secondary" disabled>Current plan</button>;
    if (!c.purchasable) return <Link className="secondary" href="/">Open projects</Link>;
    if (!enabled) return <><button type="button" className={primary} disabled aria-describedby={'soon-' + c.id}>Upgrade to {c.name}</button><span id={'soon-' + c.id} className="fine block">Coming soon</span></>;
    return <button type="button" className={primary} disabled={busy} onClick={() => void buy(c.id)}>Upgrade to {PLANS[c.id].name}</button>;
  }
  const until = b?.plan.until ? ` until ${b.plan.until.slice(0, 10)}` : '';
  return <>
    {signedIn === false && <p className="fine section-gap">Already have an account? <Link className="help-link" href="/auth/sign-in?return_to=%2Fplans">Sign in</Link> to see your plan or upgrade.</p>}
    {b && <section className="section-gap" aria-labelledby="h-your-plan">
      <h2 id="h-your-plan">Your plan: <span className="stage-chip" data-testid="plan-badge">{b.plan.name}</span></h2>
      <p className="fine">{b.plan.cap}.{b.plan.status === 'halted' ? ` Your last payment failed; you keep ${b.plan.name}${until} while the payment is retried.` : b.plan.status === 'cancelled' ? ` Cancelled: you keep ${b.plan.name}${until}.` : b.plan.source === 'lapsed' ? ' Your subscription ended, so the account is on Free.' : betaName && b.plan.source === 'server_default' && b.plan.name === betaName ? ' Free during the early beta, as described above.' : ''}</p>
      {enabled && <div className="actions"><label>Billing<select value={interval} onChange={e => setBillEvery(e.target.value as 'month' | 'year')}><option value="month">Monthly</option><option value="year">Yearly</option></select></label></div>}
      {localDouble && <p className="fine">Test checkout: no real payment is taken here.</p>}
    </section>}
    {error && <p className="error" role="alert">{error}</p>}
    <div className="plan-grid section-gap">
      {cards.map(c => <section key={c.id} className={'editor plan-card' + (c.id === RECOMMENDED ? ' is-recommended' : '') + (c.id === chosen ? ' is-chosen' : '')} aria-labelledby={'plan-' + c.id} data-plan={c.id}>
        {c.id === RECOMMENDED && <span className="plan-flag">Recommended</span>}
        <p className="eyebrow" id={'plan-' + c.id}>{c.name.toUpperCase()}</p>
        <p className="price">{c.price}{c.per && <small> / {c.per}</small>}</p>{c.yearly && <p className="quiet">{c.yearly}</p>}
        <p className="quiet section-gap">{c.blurb}</p>
        <ul className="bullets">{c.lines.map(l => <li key={l}>{l}</li>)}</ul>
        {c.soon.length > 0 && <div className="plan-soon" data-testid={'plan-soon-' + c.id}><p className="eyebrow section-gap" id={'soon-list-' + c.id}>Coming soon · not included yet</p><ul className="bullets quiet" style={{flex: 'none', marginTop: 0}} aria-labelledby={'soon-list-' + c.id}>{c.soon.map(l => <li key={l}>{l}</li>)}</ul></div>}
        <div className="plan-action">{action(c)}</div>
      </section>)}
    </div>
    {b && b.invoices.length > 0 && <section className="section-gap"><h3>Your ScopeFlow invoices</h3><ul className="bullets">{b.invoices.map(i => <li key={i.id}><Link className="help-link" href={`/plans/invoices/${i.id}`}>{i.number}</Link> · {i.issued.slice(0, 10)} · {(i.amount_minor / 100).toFixed(2)} {i.currency}</li>)}</ul></section>}
  </>;
}
