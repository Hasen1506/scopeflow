import type {Metadata} from 'next';
import Link from 'next/link';
import {Header} from '../ui';
import {NextStep} from '../workflow';
import {activePlan, planCards, projectCapLine} from '@/lib/plans';
import {billingStatus} from '@/lib/billing';
import {formatMoney} from '@/lib/currency';
import {getUser} from '@/lib/auth/server';
import Upgrade from './upgrade';

export const metadata: Metadata = {title: 'Plans — Scopeflow'};

// L13/M13: the Plans page renders from the PLANS table (lib/plans.ts), the same table the caps are
// enforced from. Paid plans are bought here (Razorpay Subscriptions for INR, Stripe Billing
// otherwise); <Upgrade/> shows the signed-in account's plan badge and each card's action.
type Props = {searchParams: Promise<{currency?: string; checkout?: string; plan?: string}>};
export const dynamic = 'force-dynamic';

/** Server-setup detail (which keys are missing) is for the operator only: a dev server, or an email in SCOPEFLOW_ADMIN_EMAILS. */
async function operatorView() {
 if (process.env.NODE_ENV !== 'production') return true;
 const admins = (process.env.SCOPEFLOW_ADMIN_EMAILS || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
 if (!admins.length) return false;
 try { const user = await getUser({fresh: false}); return !!user?.email && admins.includes(user.email.toLowerCase()); } catch { return false; }
}

export default async function Plans({searchParams}: Props){
 const q = await searchParams, currency = q.currency?.toUpperCase() === 'USD' ? 'USD' : 'INR';
 const money = (n: number) => formatMoney(n, currency);
 const cards = planCards(currency, money), fallback = activePlan(), billing = billingStatus();
 const operator = !billing.enabled && await operatorView();
 const chosen = cards.some(c => c.id === q.plan) ? q.plan : undefined;
 return <><Header/><main id="content" tabIndex={-1} className="shell">
  <div className="page-heading"><div><p className="eyebrow">ACCOUNT · PLANS</p><h1>Start small.<br/><em>Keep reviewing free.</em></h1></div><p>Client reviewing is always free.<br/>{currency === 'INR' ? 'Prices include GST.' : 'Prices in US dollars.'}</p></div>
  <NextStep title={billing.enabled ? 'Pick the plan that fits' : 'Upgrades open soon'}>{billing.enabled ? 'Upgrade any time; your projects and records stay as they are. Cancel and you keep the plan until the end of the paid period.' : <>Every feature is free during the early beta, so there is nothing to choose yet. Want a paid plan when it opens? <Link className="help-link" href="/support">Contact us</Link>.</>}</NextStep>
  {operator && billing.reason && <p className="muted-box" data-testid="operator-billing-note"><strong>Operator note (only you see this):</strong> {billing.reason}</p>}
  {q.checkout === 'done' && <p className="muted-box" role="status">Payment received. Your plan updates as soon as the payment provider confirms it, usually within a minute.</p>}
  {q.checkout === 'cancelled' && <p className="muted-box" role="status">Checkout cancelled. Nothing was charged.</p>}
  <nav className="actions section-gap" aria-label="Show prices in">
   <Link className={currency === 'INR' ? 'primary' : 'secondary'} href="/plans" aria-current={currency === 'INR' ? 'page' : undefined}>Indian rupees</Link>
   <Link className={currency === 'USD' ? 'primary' : 'secondary'} href="/plans?currency=USD" aria-current={currency === 'USD' ? 'page' : undefined}>US dollars</Link>
  </nav>
  <Upgrade currency={currency} enabled={billing.enabled} localDouble={billing.local_double} cards={cards} chosen={chosen}/>
  <div className="muted-box section-gap">Accounts without a subscription work under this server’s default plan, {fallback.name}: {projectCapLine(fallback.limits)}, {fallback.limits.versions} versions and {fallback.limits.ledger_entries} record entries per project. Deposits a creator asks a client for are separate and go to the creator’s own payment account; see the <Link className="help-link" href="/terms">terms</Link>.</div>
  <p className="fine section-gap"><Link className="help-link" href="/">Back to projects</Link></p>
 </main></>;
}
