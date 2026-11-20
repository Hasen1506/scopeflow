'use client';

import {useMemo, useState} from 'react';
import {useRouter} from 'next/navigation';
import {toast} from 'sonner';
import {ArrowRight, Check, Copy, MessageCircle, Zap} from 'lucide-react';
import type {Scope} from '@/lib/scope';
import {JURISDICTIONS, jurisdictionById, type JurisdictionId} from '@/lib/legal-shield';
import {
  GUIDED_PACKS,
  GUIDED_STASH_KEY,
  buildGuidedScope,
  guidedPackById,
  type GuidedPackId,
} from '@/lib/protection-packs';

type GuidedBuilderProps = {
  /** When mounted inside the workspace editor, applies the built scope immediately without navigating. */
  onBuild?: (scope: Scope, whatsappRecap: string) => void;
  initialPackId?: GuidedPackId;
  compact?: boolean;
};

export default function GuidedBuilder({
  onBuild,
  initialPackId = 'rental-deposit',
  compact = false,
}: GuidedBuilderProps) {
  const router = useRouter();
  const [packId, setPackId] = useState<GuidedPackId>(initialPackId);
  const [jurisdiction, setJurisdiction] = useState<JurisdictionId>('IN-KA');
  const pack = guidedPackById(packId);
  const jRule = jurisdictionById(jurisdiction);

  const [subject, setSubject] = useState('');
  const [party, setParty] = useState('');
  const [amount, setAmount] = useState<string>(String(pack.defaultAmountINR));
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [extra, setExtra] = useState('');

  function pickPack(nextId: GuidedPackId) {
    const nextPack = guidedPackById(nextId);
    setPackId(nextId);
    setAmount(String(jRule.country === 'IN' ? nextPack.defaultAmountINR : nextPack.defaultAmountUSD));
    setSubject('');
    setParty('');
    setExtra('');
  }

  function pickJurisdiction(nextJ: JurisdictionId) {
    const prevCountry = jRule.country;
    const nextRule = jurisdictionById(nextJ);
    setJurisdiction(nextJ);
    if (prevCountry !== nextRule.country) {
      setAmount(String(nextRule.country === 'IN' ? pack.defaultAmountINR : pack.defaultAmountUSD));
    }
  }

  const built = useMemo(
    () =>
      buildGuidedScope({
        packId,
        jurisdiction,
        subject: subject.trim() || pack.subjectPlaceholder.replace(/^e\.g\.\s*/i, ''),
        party: party.trim() || pack.partyPlaceholder.replace(/^e\.g\.\s*/i, ''),
        amount: Number(amount) || (jRule.country === 'IN' ? pack.defaultAmountINR : pack.defaultAmountUSD),
        date,
        extra: extra.trim() || undefined,
      }),
    [packId, jurisdiction, subject, party, amount, date, extra, jRule.country, pack],
  );

  function handleBuild() {
    if (onBuild) {
      onBuild(built.scope, built.whatsappRecap);
      return;
    }
    try {
      sessionStorage.setItem(GUIDED_STASH_KEY, JSON.stringify(built.scope));
      router.push('/?guided=1');
    } catch {
      toast.error('Could not stage draft in this browser.');
    }
  }

  async function copyWhatsApp() {
    try {
      await navigator.clipboard.writeText(built.whatsappRecap);
      toast.success('WhatsApp confirmation recap copied.');
    } catch {
      toast.error('Copy failed. Please try again.');
    }
  }

  return (
    <section
      className={compact ? 'guided-builder is-compact' : 'editor guided-builder'}
      aria-labelledby="guided-builder-heading"
    >
      <div className="guided-head">
        <div>
          <p className="eyebrow flush">30-second Quick-Fill · Zero blank-page friction</p>
          <h2 id="guided-builder-heading" className="h-sub">
            Answer 4 quick questions — get a protective agreement &amp; WhatsApp confirm
          </h2>
        </div>
        <label className="guided-region">
          <span className="sr-only">Jurisdiction</span>
          <select
            value={jurisdiction}
            onChange={e => pickJurisdiction(e.target.value as JurisdictionId)}
            aria-label="Jurisdiction"
          >
            <optgroup label="India">
              {JURISDICTIONS.filter(j => j.country === 'IN').map(j => (
                <option key={j.id} value={j.id}>
                  {j.label}
                </option>
              ))}
            </optgroup>
            <optgroup label="United States">
              {JURISDICTIONS.filter(j => j.country === 'US').map(j => (
                <option key={j.id} value={j.id}>
                  {j.label}
                </option>
              ))}
            </optgroup>
          </select>
        </label>
      </div>

      <div className="guided-packs" role="group" aria-label="Choose agreement type">
        {GUIDED_PACKS.map(p => {
          const active = packId === p.id;
          return (
            <button
              key={p.id}
              type="button"
              className={`guided-pack-btn${active ? ' is-selected' : ''}`}
              aria-pressed={active}
              onClick={() => pickPack(p.id)}
            >
              <span className="guided-pack-top">
                <span className="eyebrow flush">{p.audience}</span>
                {active && (
                  <span className="guided-selected-pill">
                    <Check size={12} aria-hidden="true" /> Selected
                  </span>
                )}
              </span>
              <strong>{p.title}</strong>
              <span className="fine flush">{p.subtitle}</span>
            </button>
          );
        })}
      </div>

      <div className="guided-active-bar gap-top" aria-live="polite">
        <span className="eyebrow flush">Active pack</span>
        <strong>{pack.title}</strong>
        <span className="fine flush">· {jRule.label} ({jRule.currency})</span>
      </div>

      <div className="two-col gap-top">
        <label>
          {pack.subjectLabel}
          <input
            value={subject}
            onChange={e => setSubject(e.target.value)}
            placeholder={pack.subjectPlaceholder}
          />
        </label>
        <label>
          {pack.partyLabel}
          <input
            value={party}
            onChange={e => setParty(e.target.value)}
            placeholder={pack.partyPlaceholder}
          />
        </label>
      </div>

      <div className="three-col">
        <label>
          {pack.amountLabel} ({jRule.currency})
          <input
            type="number"
            min={0}
            value={amount}
            onChange={e => setAmount(e.target.value)}
          />
        </label>
        <label>
          Target / move-in / event date
          <input
            type="date"
            value={date}
            onChange={e => setDate(e.target.value)}
          />
        </label>
        <label>
          {pack.extraLabel} <span className="quiet">· optional</span>
          <input
            value={extra}
            onChange={e => setExtra(e.target.value)}
            placeholder={pack.extraPlaceholder}
          />
        </label>
      </div>

      <div className="guided-summary gap-top">
        <div className="guided-summary-info">
          <p className="eyebrow flush">Included automatically</p>
          <p className="fine flush">
            <Check size={14} aria-hidden="true" /> {built.scope.items?.length ?? 0} concrete deliverables with
            acceptance checks · explicit exclusions · {jRule.label} protection note
          </p>
          <p className="fine flush">{pack.lowFrictionTip}</p>
        </div>
        <div className="actions">
          <button type="button" className="primary" onClick={handleBuild}>
            <Zap size={15} aria-hidden="true" />
            {onBuild ? 'Fill editor now' : 'Open in editor'}
            <ArrowRight size={15} aria-hidden="true" />
          </button>
          <button type="button" className="secondary" onClick={() => void copyWhatsApp()}>
            <Copy size={14} aria-hidden="true" />
            Copy WhatsApp confirm
          </button>
          <a
            className="help-link"
            href={'https://wa.me/?text=' + encodeURIComponent(built.whatsappRecap)}
            target="_blank"
            rel="noreferrer"
          >
            <MessageCircle size={14} aria-hidden="true" /> Open WhatsApp
          </a>
        </div>
      </div>
    </section>
  );
}
