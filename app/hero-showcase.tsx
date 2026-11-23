'use client';

import Link from 'next/link';
import {useEffect, useState} from 'react';
import {AnimatePresence, motion, useReducedMotion} from 'motion/react';
import {ArrowRight, Building2, Check, FileCheck2, Home, Lock, ShieldCheck, UtensilsCrossed} from 'lucide-react';

interface ShowcaseScenario {
  id: string;
  tab: string;
  icon: typeof Home;
  kicker: string;
  badge: string;
  title: string;
  subtitle: string;
  items: {label: string; value: string}[];
  totalLabel: string;
  totalValue: string;
  sealTop: string;
  sealMid: string;
  sealMeta: string;
  slipTone: 'shield' | 'change';
  slipTitle: string;
  slipStatus: string;
  slipDetail: string;
  ctaLabel: string;
  ctaHref: string;
}

const SCENARIOS: ShowcaseScenario[] = [
  {
    id: 'rental',
    tab: 'Apartment deposit',
    icon: Home,
    kicker: 'Deposit shield · Bengaluru',
    badge: 'SHA-256 sealed',
    title: 'Flat 402, Palm Grove',
    subtitle: 'Move-in baseline · Tenant & Landlord',
    items: [
      {label: 'Security deposit via UPI UTR', value: '₹1,50,000'},
      {label: 'Day-1 wall & meter photo baseline', value: 'Attached'},
      {label: 'Return window after key handover', value: '15 days'},
    ],
    totalLabel: 'Protected deposit',
    totalValue: '₹1,50,000',
    sealTop: 'Sealed',
    sealMid: 'WhatsApp',
    sealMeta: 'BSA s.63',
    slipTone: 'shield',
    slipTitle: 'Trap flagged & removed',
    slipStatus: 'Protected',
    slipDetail: '“1-month mandatory painting” → actual itemized bills only',
    ctaLabel: 'Scan a lease clause',
    ctaHref: '/check',
  },
  {
    id: 'catering',
    tab: 'Marriage event',
    icon: UtensilsCrossed,
    kicker: 'Wedding hub · 6 sub-events',
    badge: '4 vendors tracked',
    title: 'Mehta–Kapoor Wedding',
    subtitle: 'Haldi · Sangeet · Ceremony · Reception',
    items: [
      {label: 'Reception catering · Vikram (+91 98801)', value: '₹3,40,000'},
      {label: 'Mandap & Haldi decor · Priya (+91 98803)', value: '₹2,10,000'},
      {label: '6-event photo & cinema · Ananya (+91 98804)', value: '₹1,85,000'},
    ],
    totalLabel: 'Locked wedding budget',
    totalValue: '₹8,10,000',
    sealTop: 'Approved',
    sealMid: '6 events',
    sealMeta: 'All contacts',
    slipTone: 'change',
    slipTitle: 'Sangeet +25 extra guests',
    slipStatus: 'Confirmed',
    slipDetail: '+₹21,250 locked on WhatsApp · ₹2.25L advance UTR saved',
    ctaLabel: 'Open Marriage Event Hub',
    ctaHref: '/events',
  },
  {
    id: 'scope',
    tab: 'Client scope',
    icon: Building2,
    kicker: 'Project scope · Fixed fee',
    badge: 'Version 2 · locked',
    title: 'Website Redesign & Build',
    subtitle: 'Deliverables, 2 revisions & 50% deposit',
    items: [
      {label: 'Design system & 6 responsive pages', value: '₹72,000'},
      {label: 'Next.js build, CMS & launch handover', value: '₹48,000'},
      {label: 'Included review rounds (2 rounds)', value: 'Included'},
    ],
    totalLabel: 'Project fee',
    totalValue: '₹1,20,000',
    sealTop: 'Locked',
    sealMid: 'by client',
    sealMeta: 'SHA-256',
    slipTone: 'change',
    slipTitle: 'Change order #1',
    slipStatus: 'Pending',
    slipDetail: '+2 extra landing pages · +₹18,000',
    ctaLabel: 'Open 30-sec packs',
    ctaHref: '/templates',
  },
];

const CYCLE_MS = 5600;

export function HeroShowcase() {
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const reduced = useReducedMotion();
  const active = SCENARIOS[index];

  useEffect(() => {
    if (paused || reduced) return;
    const id = window.setInterval(() => {
      setIndex(i => (i + 1) % SCENARIOS.length);
    }, CYCLE_MS);
    return () => window.clearInterval(id);
  }, [paused, reduced]);

  const ease: [number, number, number, number] = [0.16, 1, 0.3, 1];

  return (
    <div
      className="vignette-card hero-showcase"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocusCapture={() => setPaused(true)}
      onBlurCapture={() => setPaused(false)}
    >
      <div className="hs-tabs" role="tablist" aria-label="Example agreements protected with TermsLock">
        {SCENARIOS.map((s, i) => {
          const Icon = s.icon;
          const selected = i === index;
          return (
            <button
              key={s.id}
              type="button"
              role="tab"
              aria-selected={selected}
              className={`hs-tab${selected ? ' is-active' : ''}`}
              onClick={() => setIndex(i)}
            >
              <Icon size={13} aria-hidden="true" />
              <span>{s.tab}</span>
            </button>
          );
        })}
      </div>

      <div className="vc-doc hs-doc" role="tabpanel" aria-live="polite">
        {!reduced && !paused && (
          <motion.span
            key={`bar-${active.id}`}
            className="hs-progress"
            aria-hidden="true"
            initial={{scaleX: 0}}
            animate={{scaleX: 1}}
            transition={{duration: CYCLE_MS / 1000, ease: 'linear'}}
          />
        )}

        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={active.id}
            initial={reduced ? {opacity: 1} : {opacity: 0, y: 10}}
            animate={{opacity: 1, y: 0}}
            exit={reduced ? {opacity: 1} : {opacity: 0, y: -8}}
            transition={{duration: reduced ? 0 : 0.24, ease}}
          >
            <div className="vc-head hs-head">
              <span className="hs-kicker">{active.kicker}</span>
              <span className="hs-status">
                {active.slipTone === 'shield' ? (
                  <ShieldCheck size={12} aria-hidden="true" />
                ) : (
                  <Lock size={12} aria-hidden="true" />
                )}
                {active.badge}
              </span>
            </div>

            <div className="hs-title-block">
              <p className="vc-title hs-title">{active.title}</p>
              <p className="hs-subtitle">{active.subtitle}</p>
            </div>

            <ul className="vc-items hs-items">
              {active.items.map((item, idx) => (
                <motion.li
                  key={item.label}
                  initial={reduced ? {opacity: 1} : {opacity: 0, x: -6}}
                  animate={{opacity: 1, x: 0}}
                  transition={{duration: reduced ? 0 : 0.2, delay: reduced ? 0 : 0.04 * (idx + 1), ease}}
                >
                  <Check size={15} aria-hidden="true" />
                  <span>{item.label}</span>
                  <span className="vc-amt">{item.value}</span>
                </motion.li>
              ))}
            </ul>

            <div className="vc-total hs-total">
              <div className="hs-total-copy">
                <span>{active.totalLabel}</span>
                <strong>{active.totalValue}</strong>
              </div>
              <motion.div
                className="vc-seal hs-seal"
                initial={reduced ? {opacity: 1} : {opacity: 0, scale: 1.22, rotate: -18}}
                animate={{opacity: 1, scale: 1, rotate: -10}}
                transition={
                  reduced
                    ? {duration: 0}
                    : {type: 'spring', stiffness: 360, damping: 22, delay: 0.14}
                }
              >
                <span className="vc-seal-top">{active.sealTop}</span>
                <span className="vc-seal-mid">{active.sealMid}</span>
                <span className="vc-seal-date">{active.sealMeta}</span>
              </motion.div>
            </div>
          </motion.div>
        </AnimatePresence>

        <div className="hs-foot">
          <span className="hs-foot-note">
            <FileCheck2 size={13} aria-hidden="true" />
            Illustrative record
          </span>
          <Link className="hs-foot-link" href={active.ctaHref}>
            {active.ctaLabel}
            <ArrowRight size={13} aria-hidden="true" />
          </Link>
        </div>
      </div>

      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={`slip-${active.id}`}
          className={`vc-slip hs-slip${active.slipTone === 'shield' ? ' is-shield' : ''}`}
          initial={reduced ? {opacity: 1} : {opacity: 0, y: 12, rotate: -3.5}}
          animate={{opacity: 1, y: 0, rotate: -1.8}}
          exit={reduced ? {opacity: 1} : {opacity: 0, y: 6}}
          transition={{duration: reduced ? 0 : 0.24, delay: reduced ? 0 : 0.1, ease}}
        >
          <span className="vc-pin" aria-hidden="true" />
          <strong>{active.slipTitle}</strong>
          <span className="vc-slip-body">{active.slipDetail}</span>
          <span className={`vc-pending${active.slipTone === 'shield' ? ' is-ok' : ''}`}>{active.slipStatus}</span>
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
