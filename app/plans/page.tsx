import Link from 'next/link';
import {Header} from '../ui';
import {NextStep} from '../workflow';
import {activePlan, planCards, projectCapLine} from '@/lib/plans';
import {billingStatus} from '@/lib/billing';
import {formatMoney} from '@/lib/currency';
import Upgrade from './upgrade';

// L13/M13: the Plans page renders from the PLANS table (lib/plans.ts), the same table the caps are
// enforced from. Paid plans are bought here (Razorpay Subscriptions for INR, Stripe Billing
// otherwise); <Upgrade/> shows the signed-in account's plan badge and starts checkout.
type Props = {searchParams: Promise<{currency?: string; checkout?: string}>};
export const dynamic = 'force-dynamic';
export default async function Plans({searchParams}: Props){
 const q = await searchParams, currency = q.currency?.toUpperCase() === 'USD' ? 'USD' : 'INR';
 const money = (n: number) => formatMoney(n, currency);
 const cards = planCards(currency, money), fallback = activePlan(), billing = billingStatus();
 return <><Header/><main id="main" className="shell">
  <div className="page-heading"><div><p className="eyebrow">ACCOUNT · PLANS</p><h1>Start small.<br/><em>Keep reviewing free.</em></h1></div><p>Client reviewing is always free.<br/>{currency === 'INR' ? 'Prices include GST.' : 'Prices in US dollars.'}</p></div>
  <NextStep title={billing.enabled ? 'Pick the plan that fits' : 'Nothing to pay yet'} actions={<Link className="primary" href="/">Back to projects</Link>}>{billing.enabled ? 'Upgrade any time; your projects and records stay as they are. Cancel and you keep the plan until the end of the paid period.' : billing.reason}</NextStep>
  {q.checkout === 'done' && <p className="muted-box" role="status">Payment received. Your plan updates as soon as the payment provider confirms it, usually within a minute.</p>}
  {q.checkout === 'cancelled' && <p className="muted-box" role="status">Checkout cancelled. Nothing was charged.</p>}
  <nav className="actions section-gap" aria-label="Show prices in">
   <Link className={currency === 'INR' ? 'primary' : 'secondary'} href="/plans" aria-current={currency === 'INR' ? 'page' : undefined}>Indian rupees</Link>
   <Link className={currency === 'USD' ? 'primary' : 'secondary'} href="/plans?currency=USD" aria-current={currency === 'USD' ? 'page' : undefined}>US dollars</Link>
  </nav>
  <Upgrade currency={currency} enabled={billing.enabled} localDouble={billing.local_double}/>
  <div className="work-grid">
   {cards.map(c => <section key={c.id} className="editor" aria-labelledby={'plan-' + c.id} data-plan={c.id}>
    <p className="eyebrow" id={'plan-' + c.id}>{c.name.toUpperCase()}</p>
    <p className="price">{c.price}{c.per && <small> / {c.per}</small>}</p>{c.yearly && <p className="quiet">{c.yearly}</p>}
    <p className="quiet section-gap">{c.blurb}</p>
    <ul className="bullets">{c.lines.map(l => <li key={l}>{l}</li>)}</ul>
   </section>)}
  </div>
  <div className="muted-box section-gap">Accounts without a subscription work under this server’s default plan, {fallback.name}: {projectCapLine(fallback.limits)}, {fallback.limits.versions} versions and {fallback.limits.ledger_entries} record entries per project. Deposits a creator asks a client for are separate and go to the creator’s own payment account; see the <Link className="help-link" href="/terms">terms</Link>.</div>
 </main></>;
}
