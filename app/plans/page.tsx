import Link from 'next/link';
import {Header} from '../ui';

export default function Plans(){
 return <><Header/><main className="shell">
  <div className="page-heading"><div><p className="eyebrow">PRICING PREVIEW</p><h1>Start small.<br/>Keep reviewing free.</h1></div><p>Proposed launch packages.<br/>The current beta is free. Billing is not enabled.</p></div>
  <div className="work-grid">
   <section className="editor"><p className="eyebrow">FREE · PROPOSED</p><h2 style={{fontSize:42}}>$0</h2><p className="quiet section-gap">For your first client scope.</p><ul className="section-gap" style={{paddingLeft:20,listStyle:'disc'}}><li>One active client project</li><li>Free client reviewing</li><li>Clear scope, revisions, and decision history</li><li>Print or export your project</li></ul><p className="fine">Proposed free package after billing launches. Current beta limits are listed below.</p></section>
   <section className="editor"><p className="eyebrow">SOLO · PROPOSED</p><h2 style={{fontSize:42}}>$4 <span style={{fontSize:16,fontWeight:400}}>/ month</span></h2><p className="quiet section-gap">Or $36 billed yearly · equivalent to $3/month.</p><ul className="section-gap" style={{paddingLeft:20,listStyle:'disc'}}><li>10 active client projects</li><li>Free client reviewing</li><li>Version history and change comparisons</li><li>Reuse scopes as new drafts</li><li>API and ChatGPT connector access</li></ul><p className="fine">A launch price to test with pilot customers. No checkout, charge, or subscription is available yet. The ChatGPT connector still needs live connection testing.</p></section>
  </div>
  <div className="muted-box section-gap">The current early beta is free to test, with a safety limit of 100 projects and 100 versions per project. Proposed plan limits are not enforced. There is no automatic renewal or payment collection.</div>
  <p className="quiet section-gap">Team workspaces and custom branding are planned separately. They are not included in the current beta.</p>
  <Link className="primary" href="/">Try the workspace</Link>
 </main></>;
}
