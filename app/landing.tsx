'use client';
import Link from 'next/link';
import {ArrowUpRight} from 'lucide-react';
import {ReviewVignette} from './ui';
import {TryContext} from './try-editor';

// What a signed-out visitor sees at /. It holds no draft and no account data, so nothing typed in
// the editor (by this visitor or a previous account on this browser) can show up here.
// The sections under the hero are server-rendered (passed as children) so their icons are not client JS.
export default function Landing({onTry, children}: {onTry: () => void; children?: React.ReactNode}) {
  return <TryContext.Provider value={onTry}><div className="landing">
    <section className="hero hero-split" aria-labelledby="hero-title">
      <div><p className="eyebrow ruled">Scopes · approvals · change orders · payments</p><h1 id="hero-title">Good work starts with a <em>clear agreement.</em></h1><p className="tagline">Define the work, get it approved on a version-locked link, and keep the next “small change” on the record.</p>
        <div className="actions"><Link className="primary" href="/auth/sign-up?return_to=%2F" prefetch={false}>Create an account<ArrowUpRight size={17}/></Link><Link className="secondary" href="/auth/sign-in?return_to=%2F" prefetch={false}>Sign in</Link></div>
        <p className="fine">Or <button className="help-link" onClick={onTry}>try the editor without an account</button>. Nothing is saved until you sign in.</p></div>
      <ReviewVignette/>
    </section>
    {children}
  </div></TryContext.Provider>;
}
