import Link from 'next/link';
import {Header, Vignette} from './ui';

// Any unknown path, and notFound() from a page. Same chrome as every other page, with a way back.
export default function NotFound() {
  return <><Header /><main id="main" className="auth-layout"><section className="editor">
    <p className="eyebrow">PAGE NOT FOUND</p><h1>Nothing is surveyed here.</h1>
    <p className="section-gap">The page you asked for does not exist or has moved. If you followed a review link, ask the person who shared it for a fresh one: replaced and revoked links stop working.</p>
    <div className="actions section-gap"><Link className="primary" href="/">Go to your projects</Link><Link className="secondary" href="/verify">Check a receipt</Link><Link className="help-link" href="/support">Support</Link></div>
  </section><aside className="auth-aside" aria-hidden="true"><Vignette /></aside></main></>;
}
