import Link from 'next/link';
import {Header} from '../ui';
import {NextStep} from '../workflow';
import {PLANS, activePlan} from '@/lib/plans';
import {formatMoney} from '@/lib/currency';

type Props = {searchParams: Promise<{currency?: string}>};
export default async function Plans({searchParams}: Props){
 const currency = (await searchParams).currency?.toUpperCase() === 'INR' ? 'INR' : 'USD';
 const m = (n: number) => formatMoney(n, currency);
 const {free, solo} = PLANS, beta = activePlan().limits;
 const price = (p: typeof solo) => currency === 'INR' ? p.price.INR : p.price.USD;
 const year = (p: typeof solo) => currency === 'INR' ? p.price.INR_year : p.price.USD_year;
 return <><Header/><main id="main" className="shell">
  <div className="page-heading"><div><p className="eyebrow">ACCOUNT · PRICING PREVIEW</p><h1>Start small.<br/><em>Keep reviewing free.</em></h1></div><p>Proposed launch packages.<br/>The current beta is free. Billing is not enabled.</p></div>
  <NextStep title="Nothing to pay: the beta is free" actions={<Link className="primary" href="/">Back to projects</Link>}>These packages are proposals for a later launch. Billing is not enabled, so keep working on your projects.</NextStep>
  <nav className="actions section-gap" aria-label="Show prices in">
   <Link className={currency === 'USD' ? 'primary' : 'secondary'} href="/plans" aria-current={currency === 'USD' ? 'page' : undefined}>US dollars</Link>
   <Link className={currency === 'INR' ? 'primary' : 'secondary'} href="/plans?currency=INR" aria-current={currency === 'INR' ? 'page' : undefined}>Indian rupees</Link>
  </nav>
  <div className="work-grid">
   <section className="editor"><p className="eyebrow">FREE · PROPOSED</p><p className="price">{m(price(free))}</p><p className="quiet section-gap">For your first client scope.</p><ul className="bullets"><li>{free.limits.projects === 1 ? 'One active client project' : `${free.limits.projects} active client projects`}</li><li>Free client reviewing</li><li>Clear scope, revisions, and decision history</li><li>Print or export your project</li></ul><p className="fine">Proposed free package after billing launches. Current beta limits are listed below.</p></section>
   <section className="editor"><p className="eyebrow">SOLO · PROPOSED</p><p className="price">{m(price(solo))} <small>/ month</small></p><p className="quiet section-gap">Or {m(year(solo))} billed yearly{currency === 'INR' ? ' · prices include GST' : ` · equivalent to ${m(year(solo) / 12)}/month`}.</p><ul className="bullets"><li>{solo.limits.projects} active client projects</li><li>Free client reviewing</li><li>Version history and change comparisons</li><li>Invoices, statements and automatic reminders</li><li>API and ChatGPT connector access</li></ul><p className="fine">A launch price to test with pilot customers. No checkout, charge, or subscription is available yet. The ChatGPT connector still needs live connection testing.</p></section>
  </div>
  <div className="muted-box section-gap">The current early beta is free to test, with a safety limit of {beta.projects} projects per account, {beta.versions} versions and {beta.ledger_entries} record entries per project. Proposed plan limits are not enforced. Scopeflow does not charge you: there is no plan payment, subscription or automatic renewal. Deposits a creator asks a client for are separate; see the <Link className="help-link" href="/terms">terms</Link>.</div>
  <p className="quiet section-gap">Team workspaces are planned separately and not included in the current beta.</p>
 </main></>;
}
