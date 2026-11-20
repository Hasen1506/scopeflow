'use client';

import Link from 'next/link';
import {
  ArrowRight,
  ArrowUpRight,
  BadgeCheck,
  Building2,
  Calculator,
  FileCheck2,
  Fingerprint,
  Home,
  MessageCircle,
  Repeat2,
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
    eyebrow: 'Weddings & Catering',
    title: 'Lock menus, plate counts & extra-guest caps',
    body: 'Eliminate event-day billing shocks and vague “standard buffet” swaps with a 30-second catering agreement and a 5-line WhatsApp confirm.',
    href: '/templates',
    cta: 'Build catering pack',
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

const FRICTION_LADDER = [
  {
    step: 'Level 1',
    icon: MessageCircle,
    title: 'The 10-second WhatsApp soft confirm',
    body: 'Landlords and local caterers rarely sign a 6-page PDF from an unfamiliar app. Send a polite 5-line recap — a simple “Confirmed” reply plus your bank UTR creates admissible written proof.',
  },
  {
    step: 'Level 2',
    icon: FileCheck2,
    title: '1-Tap version-locked review link',
    body: 'When both sides want a proper agreement, share one clean link. Zero signup required for the other party; every change after approval becomes a priced change order.',
  },
  {
    step: 'Level 3',
    icon: Fingerprint,
    title: 'Unilateral timestamped evidence record',
    body: 'Even if they refuse to sign or reply, seal a SHA-256 timestamped move-in checklist, photo baseline, or formal dispute notice ready for Small Claims, Rent Court, or e-Daakhil.',
  },
];

const PILLARS = [
  {
    icon: ShieldCheck,
    title: 'Trap scanner & clarity check before you pay',
    body: 'Catches blanket painting deductions, non-refundable forfeitures, vague “etc.” deliverables, and missing deadlines — with 1-click safe rewrites.',
  },
  {
    icon: Zap,
    title: '30-second Quick-Fill, zero blank pages',
    body: 'Nobody enjoys drafting agreements from scratch. Answer 4 concrete questions (who, what, amount, date) and get a complete protective document immediately.',
  },
  {
    icon: Repeat2,
    title: 'Change orders that keep pace with reality',
    body: 'Every “small extra” — extra guests, extra room, extra feature — is logged, priced, and confirmed against the original locked version.',
  },
  {
    icon: BadgeCheck,
    title: 'Tamper-evident receipts anyone can verify',
    body: 'Approvals and ledgers carry verifiable fingerprints and QR receipt checks, plus a BSA 2023 s.63 / ESIGN evidence trail when disputes arise.',
  },
];

export default function Landing({onTry}: {onTry: () => void}) {
  return (
    <div className="landing">
      <section className="hero hero-split" aria-labelledby="hero-title">
        <div>
          <p className="eyebrow ruled">Agreements · Deposit Shield · WhatsApp Confirms · Change Orders</p>
          <h1 id="hero-title">
            Clear agreements — <em>even when they won’t sign a formal contract.</em>
          </h1>
          <p className="tagline">
            Protect apartment deposits, catering advances, home renovations, and client projects in 30 seconds. Check
            unfair clauses first, then lock proof via WhatsApp soft confirm, a 1-tap review link, or a timestamped
            evidence record.
          </p>
          <div className="actions">
            <Link className="primary" href="/check">
              Check a lease or quote
              <ArrowRight size={17} aria-hidden="true" />
            </Link>
            <button type="button" className="secondary" onClick={onTry}>
              <Zap size={16} aria-hidden="true" />
              Try editor free
            </button>
            <Link className="secondary" href="/templates">
              30-sec packs
            </Link>
          </div>
          <p className="fine">
            No account required to scan clauses or build a draft. Ready to save &amp; send live review links?{' '}
            <Link className="help-link" href="/auth/sign-up?return_to=%2F">
              Create a free account
            </Link>
            .
          </p>
        </div>
        <ReviewVignette />
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
        <p className="eyebrow ruled">The “Won’t Sign” Ladder</p>
        <h2 id="lp-ladder">
          Meet the other side at the <em>lowest friction</em> they’ll accept
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
      </section>

      <section className="lp-section" aria-labelledby="lp-pillars">
        <p className="eyebrow ruled">Why TermsLock holds up</p>
        <h2 id="lp-pillars">
          Four safeguards, <em>on one verifiable record</em>
        </h2>
        <ul className="lp-pillars">
          {PILLARS.map(({icon: Icon, title, body}) => (
            <li key={title} className="lp-card">
              <Icon size={20} aria-hidden="true" />
              <h3>{title}</h3>
              <p>{body}</p>
            </li>
          ))}
        </ul>
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
          <button type="button" className="secondary" onClick={onTry}>
            Open the editor
          </button>
        </div>
      </section>
    </div>
  );
}
