import type {Metadata} from 'next';
import {Suspense} from 'react';
import {Header} from '../ui';
import ShareClient from './share-client';
import PwaSetup from './pwa-setup';

// /share (WS-06): where the PWA share target lands (SF-03) and where the WhatsApp bot's draft links
// open (SF-04): pick the project, read the radar's verdict with the cited clause, review the
// prefilled change order and propose it, then share it back on WhatsApp. /share?project=<id> is the
// project's "tell the client" view: review link, change orders and invoices with their email status
// and a WhatsApp share each (H18, LT-03, SF-01).
export const metadata: Metadata = {title: 'Share with Scopeflow', manifest: '/manifest.webmanifest', robots: {index: false}};
export const dynamic = 'force-dynamic';

export default function SharePage() {
  return <><Header /><main id="content" tabIndex={-1} className="shell"><Suspense fallback={<p role="status">Loading…</p>}><ShareClient /></Suspense><PwaSetup /></main></>;
}
