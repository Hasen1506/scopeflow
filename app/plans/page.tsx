import Link from 'next/link';
import {Header} from '../ui';
import {NextStep} from '../workflow';

export default function Plans(){
 return <><Header/><main id="main" className="shell">
  <div className="page-heading"><div><p className="eyebrow">ACCOUNT · PRICING PREVIEW</p><h1>Start small.<br/><em>Keep reviewing free.</em></h1></div><p>Proposed launch packages.<br/>The current beta is free. Billing is not enabled.</p></div>
  <NextStep title="Nothing to pay: the beta is free" actions={<Link className="primary" href="/">Back to projects</Link>}>These packages are proposals for a later launch. Billing is not enabled, so keep working on your projects.</NextStep>
  <div className="work-grid">
   <section className="editor"><p className="eyebrow">FREE · PROPOSED</p><p className="price">$0</p><p className="quiet section-gap">For your first client scope.</p><ul className="bullets"><li>One active client project</li><li>Free client reviewing</li><li>Clear scope, revisions, and decision history</li><li>Print or export your project</li></ul><p className="fine">Proposed free package after billing launches. Current beta limits are listed below.</p></section>
   <section className="editor"><p className="eyebrow">SOLO · PROPOSED</p><p className="price">$4 <small>/ month</small></p><p className="quiet section-gap">Or $36 billed yearly · equivalent to $3/month.</p><ul className="bullets"><li>10 active client projects</li><li>Free client reviewing</li><li>Version history and change comparisons</li><li>Reuse scopes as new drafts</li><li>API and ChatGPT connector access</li></ul><p className="fine">A launch price to test with pilot customers. No checkout, charge, or subscription is available yet. The ChatGPT connector still needs live connection testing.</p></section>
  </div>
  <div className="muted-box section-gap">The current early beta is free to test, with a safety limit of 100 projects and 100 versions per project. Proposed plan limits are not enforced. Scopeflow does not charge you: there is no plan payment, subscription or automatic renewal. Deposits a creator asks a client for are separate; see the <Link className="help-link" href="/terms">terms</Link>.</div>
  <p className="quiet section-gap">Team workspaces and custom branding are planned separately. They are not included in the current beta.</p>
 </main></>;
}
