'use client';
/* eslint-disable @next/next/no-img-element -- decorative art is pre-optimised WebP with fixed dimensions; next/image adds nothing here */
import Link from 'next/link';
import {useRouter} from 'next/navigation';
import {useState, type FormEvent} from 'react';
import {ArrowRight} from 'lucide-react';
import {Brand} from './ui';

/** Footer receipt check: paste the link printed on a PDF receipt (or its QR target) to open /verify with it. */
function ReceiptCheck() {
  const router = useRouter();
  const [value, setValue] = useState('');
  function submit(e: FormEvent) {
    e.preventDefault();
    const text = value.trim();
    let query = '';
    try {
      const url = new URL(text, location.origin);
      const p = url.searchParams.get('p'), v = url.searchParams.get('v'), a = url.searchParams.get('a');
      if (p && v && a) query = '?' + new URLSearchParams({p, v, a}).toString();
    } catch { /* not a link: open the form */ }
    router.push('/verify' + query);
  }
  return (
    <form className="receipt-form" onSubmit={submit} role="search" aria-label="Verify a receipt">
      <label className="sr-only" htmlFor="receipt-check">Receipt link from a PDF receipt</label>
      <input id="receipt-check" value={value} onChange={e => setValue(e.target.value)} placeholder="Paste a receipt link" autoComplete="off" spellCheck={false} />
      <button type="submit" aria-label="Open the receipt check"><ArrowRight size={18} /></button>
    </form>
  );
}

export function SiteFooter() {
  return (
    <footer className="site-footer no-print">
      <div className="footer-band">
        <div className="footer-inner">
          <div className="footer-brand">
            <Brand beta={false} />
            <p className="tagline">Scopes your clients can read, approve, and hold you to.</p>
          </div>
          <nav className="footer-col" aria-label="Product">
            <h2>Product</h2>
            <ul><li><Link href="/">Workspace</Link></li><li><Link href="/connect">Connect an agent</Link></li><li><Link href="/plans">Plans</Link></li><li><Link href="/account">Data controls</Link></li></ul>
          </nav>
          <nav className="footer-col" aria-label="Help">
            <h2>Help</h2>
            <ul><li><Link href="/support">Support</Link></li><li><Link href="/reviewer-guide">Reviewer guide</Link></li><li><a href="/api/openapi">OpenAPI</a></li></ul>
          </nav>
          <div className="footer-col">
            <h2>Check a receipt</h2>
            <p>Confirm an approved scope was not changed after signing.</p>
            <ReceiptCheck />
          </div>
        </div>
        <div className="footer-legal">
          <span>Scopeflow · Early beta</span>
          <nav aria-label="Legal"><Link href="/privacy">Privacy</Link><Link href="/terms">Terms</Link></nav>
        </div>
      </div>
      <img className="footer-art" src="/art/survey-valley-1600.webp" srcSet="/art/survey-valley-800.webp 800w, /art/survey-valley-1600.webp 1600w" sizes="100vw" alt="" width={1600} height={522} loading="lazy" decoding="async" />
    </footer>
  );
}
