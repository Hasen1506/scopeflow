import Link from 'next/link';
import {Header, Vignette} from './ui';

// Any unknown path, and notFound() from a page. Same chrome as every other page, with a way back.
// LT-10: plain words and the one thing to do; review links have their own page (app/review/[token]/link-problem.tsx).
export default function NotFound() {
  return <><Header /><main id="main" className="auth-layout"><section className="editor">
    <p className="eyebrow">PAGE NOT FOUND</p><h1>This page isn’t here.</h1>
    <p className="section-gap">The page you asked for does not exist or has moved.</p>
    <p className="section-gap">If you followed a review link, ask the person who sent it for a new link: replaced and withdrawn links stop working.</p>
    <div className="actions section-gap"><Link className="primary" href="/">Go to the home page</Link><Link className="secondary" href="/verify">Check a receipt</Link><Link className="help-link" href="/support">Support</Link></div>
  </section><aside className="auth-aside" aria-hidden="true"><Vignette /></aside></main></>;
}
