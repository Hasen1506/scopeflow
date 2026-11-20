import type {Metadata} from 'next';
import ShieldClient from './shield-client';

export const metadata: Metadata = {
  title: 'Rights & Deposit Check — TermsLock',
  description:
    'Scan rental leases, catering quotes, renovation BOQs, and freelance scopes for deposit traps and unfair clauses across India and US law, then generate a low-friction WhatsApp confirm or timestamped record.',
};

export default function CheckPage() {
  return <ShieldClient />;
}
