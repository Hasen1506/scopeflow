'use client';

import Link from 'next/link';
import {
  ArrowRight,
  ArrowUpRight,
  Building2,
  Calculator,
  FileCheck2,
  Fingerprint,
  Home,
  MessageCircle,
  ShieldCheck,
  UtensilsCrossed,
  Zap,
} from 'lucide-react';
import {ReviewVignette} from './ui';

const SCENARIO_WEDGES = [
  {
    icon: Home,
    eyebrow: 'Renters & Deposits',
    title: 'Stop arbitrary painting & deposit deductions',
    body: 'Scan landlord clauses against India (Contract Act s.74, BSA s.63, state rent rules) and US (CA 21-day, NY 14-day, TX 30-day) law, then send a Day-1 move-in record they will actually confirm.',
    href: '/check',
    cta: 'Scan rental clause',
  },
  {
    icon: UtensilsCrossed,
    eyebrow: 'Weddings & Events',
    title: 'Keep every sub-event, vendor & advance locked',
    body: 'Track Engagement, Mehendi, Haldi, Sangeet, Ceremony & Reception in one hub — with every phone number, advance paid, extra-plate cap, and 1-tap WhatsApp confirm.',
    href: '/events',
    cta: 'Open Event Hub',
  },
  {
    icon: Building2,
    eyebrow: 'Home Interiors & Trades',
    title: 'Fix material brands & stage-by-stage releases',
    body: 'Keep 15% held back until snag-list handover and stop verbal “billed as actuals” surprises with priced written change orders.',
    href: '/templates',
    cta: 'Build renovation BOQ',
  },
  {
    icon: FileCheck2,
    eyebrow: 'Freelancers & Agencies',
    title: 'End unlimited revisions & late-payment stalls',
    body: 'Version-locked scopes, client approvals without accounts, change-order ledgers, GST invoices, and statutory MSME interest calculation.',
    href: '/msme-interest',
    cta: 'Try MSME calculator',
  },
];

const STANDARD_FLOW = [
  {
    step: 'Step 1',
    icon: ShieldCheck,
    title: 'Pick your starting point',
    body: 'Got a lease or vendor quote? Paste it in Rights check to flag hidden traps. Planning a wedding or renovation with multiple vendors? Start in Events. Doing a 1-on-1 project? Open Projects.',
  },
  {
    step: 'Step 2',
    icon: Zap,
    title: 'Put the real terms in writing',
    body: 'Enter the agreed fee, advance paid (with UTR), deliverables, and key rules. ContractLock turns it into a clean, readable summary in under 30 seconds.',
  },
  {
    step: 'Step 3',
    icon: FileCheck2,
    title: 'Lock confirmation & track changes',
    body: 'Send a 1-tap Review Link (no signup needed for the other side). Once approved, any extra work becomes a priced change order with a sealed PDF receipt.',
  },
];

const FRICTION_LADDER = [
  {
    step: 'Fallback 1',
    icon: MessageCircle,
    title: '10-second WhatsApp soft confirm',
    body: 'Landlords and local caterers rarely sign a 6-page PDF from an unfamiliar app. Send a polite 5-line recap — a simple “Confirmed” reply plus your bank UTR creates written proof.',
  },
  {
    step: 'Fallback 2',
    icon: FileCheck2,
    title: '1-Tap version-locked review link',
    body: 'When both sides want a proper agreement without account friction, share one clean link. Zero signup for the other party; every post-approval change is tracked separately.',
  },
  {
    step: 'Fallback 3',
    icon: Fingerprint,
    title: 'Unilateral timestamped evidence record',
    body: 'Even if they refuse to sign or reply, seal a SHA-256 timestamped move-in checklist, photo baseline, or formal dispute notice ready for Small Claims, Rent Court, or e-Daakhil.',
  },
];

export default function Landing({
  onTry,
  signedIn = false,
  onOpenWorkspace,
}: {
  onTry: () => void;
  signedIn?: boolean;
  onOpenWorkspace?: () => void;
}) {
  const openPrimaryWorkspace = onOpenWorkspace ?? onTry;

  return (
    <div className="landing">
      <section className="hero hero-split" aria-labelledby="hero-title">
        <div>
          <p className="eyebrow ruled">Agreements · Deposit Shield · WhatsApp Confirms · Change Orders</p>
          <h1 id="hero-title">
            Clear agreements — <em>even when they won’t sign a formal contract.</em>
          </h1>
          <p className="tagline">
            Protect apartment deposits, wedding vendor chains, home renovations, and client projects in 30 seconds.
            Check unfair clauses first, then lock proof via WhatsApp soft confirm, a 1-tap review link, or a
            timestamped evidence record.
          </p>
          <div className="actions">
            {signedIn ? (
              <button type="button" className="primary" onClick={openPrimaryWorkspace}>
                Open my workspace
                <ArrowRight size={17} aria-hidden="true" />
              </button>
            ) : (
              <Link className="primary" href="/check">
                Check a lease or quote
                <ArrowRight size={17} aria-hidden="true" />
              </Link>
            )}
            {signedIn ? (
              <Link className="secondary" href="/check">
                Check a lease or quote
              </Link>
            ) : (
              <button type="button" className="secondary" onClick={onTry}>
                <Zap size={16} aria-hidden="true" />
                Try editor free
              </button>
            )}
            <Link className="secondary" href="/events">
              Event &amp; Marriage Hub
            </Link>
          </div>
          {!signedIn && (
            <p className="fine">
              No account required to scan clauses or plan an event. Ready to sync across devices &amp; send live review links?{' '}
              <Link className="help-link" href="/auth/sign-up?return_to=%2F">
                Create a free account
              </Link>
              .
            </p>
          )}
        </div>
        <ReviewVignette />
      </section>

      <section className="lp-section" aria-labelledby="lp-how">
        <p className="eyebrow ruled">The normal workflow</p>
        <h2 id="lp-how">
          How ContractLock works in <em>3 simple steps</em>
        </h2>
        <ol className="lp-ladder">
          {STANDARD_FLOW.map(({step, icon: Icon, title, body}) => (
            <li key={step} className="lp-ladder-item">
              <div className="lp-ladder-head">
                <span className="eyebrow flush">{step}</span>
                <Icon size={18} aria-hidden="true" />
              </div>
              <h3>{title}</h3>
              <p>{body}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="lp-section" aria-labelledby="lp-scenarios">
        <p className="eyebrow ruled">Built for real-world power imbalances</p>
        <h2 id="lp-scenarios">
          Every high-stakes agreement where verbal promises <em>cost you money</em>
        </h2>
        <ul className="lp-scenarios">
          {SCENARIO_WEDGES.map(({icon: Icon, eyebrow, title, body, href, cta}) => (
            <li key={title} className="lp-card">
              <div className="lp-card-top">
                <Icon size={20} aria-hidden="true" />
                <span className="eyebrow flush">{eyebrow}</span>
              </div>
              <h3>{title}</h3>
              <p>{body}</p>
              <div className="lp-card-link">
                <Link className="help-link" href={href}>
                  {cta} <ArrowRight size={14} aria-hidden="true" />
                </Link>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section className="lp-section" aria-labelledby="lp-ladder">
        <p className="eyebrow ruled">What if they won’t sign?</p>
        <h2 id="lp-ladder">
          3 fallback levels — meet them at the <em>lowest friction</em> they’ll accept
        </h2>
        <ol className="lp-ladder">
          {FRICTION_LADDER.map(({step, icon: Icon, title, body}) => (
            <li key={step} className="lp-ladder-item">
              <div className="lp-ladder-head">
                <span className="eyebrow flush">{step}</span>
                <Icon size={18} aria-hidden="true" />
              </div>
              <h3>{title}</h3>
              <p>{body}</p>
            </li>
          ))}
        </ol>
        <div className="actions section-gap">
          <Link className="secondary" href="/msme-interest">
            <Calculator size={15} aria-hidden="true" />
            Free MSME late-payment interest calculator
          </Link>
          <Link className="secondary" href="/verify">
            <ShieldCheck size={15} aria-hidden="true" />
            Verify a signed receipt
          </Link>
        </div>
      </section>

      <section className="lp-cta" aria-labelledby="lp-start">
        <div>
          <h2 id="lp-start">
            Lock the terms in <em>30 seconds.</em>
          </h2>
          <p>Before the deposit leaves your account — or before work begins.</p>
        </div>
        <div className="actions">
          <Link className="primary" href="/check">
            Scan a clause free
            <ArrowUpRight size={17} aria-hidden="true" />
          </Link>
          <button type="button" className="secondary" onClick={openPrimaryWorkspace}>
            {signedIn ? 'Open my workspace' : 'Open the editor'}
          </button>
        </div>
      </section>
    </div>
  );
}
