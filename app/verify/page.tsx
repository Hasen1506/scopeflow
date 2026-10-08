import {Suspense} from 'react';
import {Header} from '../ui';
import {VerifyRecord} from './verify-record';
export const metadata = {title: 'Verify a receipt — Scopeflow', robots: {index: false, follow: false}, referrer: 'no-referrer'};
export default function Page() {
  return <><Header /><main id="main" className="review-shell"><Suspense fallback={<p className="empty">Checking…</p>}><VerifyRecord /></Suspense></main></>;
}
