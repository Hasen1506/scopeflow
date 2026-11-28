import type { Metadata } from 'next';
import { Header } from '@/app/ui';
import EventsHub from './events-hub';

export const metadata: Metadata = {
  title: 'Event & Wedding Collections Hub — ContractLock',
  description:
    'Organize Marriage sub-events (Engagement, Mehendi, Haldi, Sangeet, Ceremony, Reception), home renovations, and multi-vendor agreements with contact numbers, advances, and 1-tap WhatsApp locks.',
};

export default function EventsPage() {
  return (
    <>
      <Header />
      <main id="content" tabIndex={-1} className="shell events-shell">
        <EventsHub />
      </main>
    </>
  );
}
