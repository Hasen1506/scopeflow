import type {Metadata} from 'next';
import Link from 'next/link';
import {Header} from '../ui';
import {NextStep} from '../workflow';
import {ALL_PLANS_INCLUDE, FOUNDING_DEADLINE, FOUNDING_SEATS, activePlan, defaultPlanNote, planCards} from '@/lib/plans';
import {billingStatus, foundingOfferOpen} from '@/lib/billing';
import {formatMoney} from '@/lib/currency';
import {getUser} from '@/lib/auth/server';
import Upgrade from './upgrade';

export const metadata: Metadata = {title: 'Plans — Scopeflow'};

// L13/M13: the Plans page renders from the PLANS table (lib/plans.ts), the same table the caps are
// enforced from. Paid plans are bought here (Razorpay Subscriptions for INR, Stripe Billing
// otherwise); <Upgrade/> shows the signed-in account's plan badge and each card's action.
type Props = {searchParams: Promise<{currency?: string; checkout?: string; plan?: string}>};
export const dynamic = 'force-dynamic';

/**
 * Server-setup detail (which keys are missing) is for the operator only: a signed-in email in SCOPEFLOW_ADMIN_EMAILS,
 * or a local server that opts in with SCOPEFLOW_DEV_OPERATOR=1. N9: never inferred from NODE_ENV, so a preview or
 * staging deploy run with `next dev` does not show env names to visitors.
 */
async function operatorView() {
 if (process.env.SCOPEFLOW_DEV_OPERATOR === '1') return true;
 const admins = (process.env.SCOPEFLOW_ADMIN_EMAILS || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
 if (!admins.length) return false;
 try { const user = await getUser({fresh: false}); return !!user?.email && admins.includes(user.email.toLowerCase()); } catch { return false; }
}

export default async function Plans({searchParams}: Props){
 const q = await searchParams, currency = q.currency?.toUpperCase() === 'USD' ? 'USD' : 'INR';
 // Whole prices without paise or cents (₹799, not ₹799.00).
 const money = (n: number) => { const s = formatMoney(n, currency); return Number.isInteger(n) ? s.replace(/[.,]00(?=\D*$)/, '') : s; };
 const showFounding = await foundingOfferOpen();
 const cards = planCards(currency, money, ['free', 'pro', 'agency'], showFounding), billing = billingStatus();
 const beta = defaultPlanNote(activePlan(), cards.map(c => c.id));
 const operator = !billing.enabled && await operatorView();
 const chosen = cards.some(c => c.id === q.plan) ? q.plan : undefined;
 return <><Header/><main id="content" tabIndex={-1} className="shell">
  <div className="page-heading"><div><p className="eyebrow">ACCOUNT · PLANS</p><h1>Start small.{' '}<br/><em>Keep reviewing free.</em></h1></div><p>Client reviewing is always free.{' '}<br/>{currency === 'INR' ? 'Prices include GST.' : 'Prices in US dollars.'}</p></div>
  <NextStep title={billing.enabled ? 'Pick the plan that fits' : 'Upgrades open soon'}>{billing.enabled ? 'Upgrade any time; your projects and records stay as they are. Cancel and you keep the plan until the end of the paid period.' : <>Every feature is free during the early beta, so there is nothing to choose yet. Want a paid plan when it opens? <Link className="help-link" href="/support">Contact us</Link>.</>}</NextStep>
  {operator && billing.reason && <p className="muted-box" data-testid="operator-billing-note"><strong>Operator note (only you see this):</strong> {billing.reason}</p>}
  {q.checkout === 'done' && <p className="muted-box" role="status">Payment received. Your plan updates as soon as the payment provider confirms it, usually within a minute.</p>}
  {q.checkout === 'cancelled' && <p className="muted-box" role="status">Checkout cancelled. Nothing was charged.</p>}
  <nav className="actions section-gap" aria-label="Show prices in">
   <Link className={currency === 'INR' ? 'primary' : 'secondary'} href="/plans" aria-current={currency === 'INR' ? 'page' : undefined}>Indian rupees</Link>
   <Link className={currency === 'USD' ? 'primary' : 'secondary'} href="/plans?currency=USD" aria-current={currency === 'USD' ? 'page' : undefined}>US dollars</Link>
  </nav>
  {beta && <section className="muted-box section-gap" aria-labelledby="h-beta" data-testid="beta-note"><h2 id="h-beta" className="h-sub">{beta.title}</h2><p>{beta.body}</p></section>}
  {showFounding && <section className="muted-box section-gap" aria-labelledby="h-founding" data-testid="founding-offer"><h2 id="h-founding" className="h-sub">Founding members</h2><p>The first {FOUNDING_SEATS} paid Freelancer or Studio subscriptions started by 30 June 2027 pay the founding price on the card. It stays for 24 months while that subscription is active. Cancelling ends the founding price; a later subscription pays the list price. The deadline is {FOUNDING_DEADLINE.slice(0, 10)}.</p></section>}
  <Upgrade currency={currency} enabled={billing.enabled} localDouble={billing.local_double} cards={cards} chosen={chosen} betaName={beta ? activePlan().name : undefined}/>
  <section className="section-gap" aria-labelledby="h-all-plans" data-testid="all-plans-include"><h2 id="h-all-plans" className="h-sub">All plans include</h2><ul className="bullets">{ALL_PLANS_INCLUDE.map(f => <li key={f}>{f}</li>)}</ul><p className="fine">The cards list the limits and the features that differ. <Link className="help-link" href="/account/team">Studio seats, the shared rate card and team activity</Link> are on Studio.</p></section>
  <p className="fine section-gap">Deposits you ask a client for are separate from your plan: they go straight to your own payment account. See the <Link className="help-link" href="/terms">terms</Link>.</p>
  <p className="fine section-gap"><Link className="help-link" href="/">Back to projects</Link></p>
 </main></>;
}
