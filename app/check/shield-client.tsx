'use client';

import {useMemo, useState} from 'react';
import {useRouter} from 'next/navigation';
import Link from 'next/link';
import {toast} from 'sonner';
import {
  AlertTriangle,
  ArrowRight,
  Check,
  CheckCircle2,
  Copy,
  FileCheck2,
  Fingerprint,
  MessageCircle,
  Printer,
  Scale,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import {Header} from '../ui';
import {
  JURISDICTIONS,
  SCENARIOS,
  analyzeAgreementText,
  buildEscalationLadder,
  jurisdictionById,
  scenarioById,
  type JurisdictionId,
  type ScenarioId,
} from '@/lib/legal-shield';
import {
  GUIDED_STASH_KEY,
  buildGuidedScope,
  type GuidedPackId,
} from '@/lib/protection-packs';
import {sealEvidenceText} from '@/lib/evidence-seal';

const SCENARIO_TO_PACK: Record<ScenarioId, GuidedPackId> = {
  rental: 'rental-deposit',
  catering: 'event-catering',
  renovation: 'home-renovation',
  'event-vendor': 'event-vendor',
  freelance: 'website-build',
};

const DEFAULT_DEFAULTS: Record<ScenarioId, {party: string; subject: string; amountIN: number; amountUS: number}> = {
  rental: {party: 'Rajesh Sharma', subject: 'Flat 402, Palm Grove Apartments', amountIN: 150000, amountUS: 2800},
  catering: {party: 'Saffron Kitchen Catering', subject: 'Reception Dinner — 250 Guests', amountIN: 225000, amountUS: 6500},
  renovation: {party: 'Studio Craft Interiors', subject: '2BHK Modular Kitchen & Wardrobes', amountIN: 450000, amountUS: 18000},
  'event-vendor': {party: 'Frame & Light Studio', subject: 'Wedding Decor & Full-Day Photo', amountIN: 95000, amountUS: 3500},
  freelance: {party: 'Northstar Clinic', subject: '5-Page Website Redesign', amountIN: 120000, amountUS: 4500},
};



export default function ShieldClient() {
  const router = useRouter();
  const [scenario, setScenario] = useState<ScenarioId>('rental');
  const [jurisdiction, setJurisdiction] = useState<JurisdictionId>('IN-KA');
  const [clauseText, setClauseText] = useState<string>(SCENARIOS[0].sampleClause);

  // Escalation ladder personalization
  const [yourName, setYourName] = useState('');
  const [partyName, setPartyName] = useState(DEFAULT_DEFAULTS.rental.party);
  const [subject, setSubject] = useState(DEFAULT_DEFAULTS.rental.subject);
  const [amount, setAmount] = useState<string>(String(DEFAULT_DEFAULTS.rental.amountIN));
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState('');
  const [sealed, setSealed] = useState<{hash: string; timestamp: string; record: string} | null>(null);
  const [sealing, setSealing] = useState(false);

  const report = useMemo(
    () => analyzeAgreementText(clauseText, scenario, jurisdiction),
    [clauseText, scenario, jurisdiction],
  );

  const jRule = jurisdictionById(jurisdiction);
  const numericAmount = Math.max(0, Number(amount) || 0);

  const ladder = useMemo(
    () =>
      buildEscalationLadder({
        scenario,
        jurisdiction,
        partyName,
        yourName,
        subject,
        amount: numericAmount,
        date,
        notes,
      }),
    [scenario, jurisdiction, partyName, yourName, subject, numericAmount, date, notes],
  );

  function selectScenario(next: ScenarioId) {
    const meta = scenarioById(next);
    const defs = DEFAULT_DEFAULTS[next];
    setScenario(next);
    setClauseText(meta.sampleClause);
    setPartyName(defs.party);
    setSubject(defs.subject);
    setAmount(String(jRule.country === 'IN' ? defs.amountIN : defs.amountUS));
    setSealed(null);
  }

  function selectJurisdiction(next: JurisdictionId) {
    const prevCountry = jurisdictionById(jurisdiction).country;
    const nextRule = jurisdictionById(next);
    setJurisdiction(next);
    if (prevCountry !== nextRule.country) {
      const defs = DEFAULT_DEFAULTS[scenario];
      setAmount(String(nextRule.country === 'IN' ? defs.amountIN : defs.amountUS));
    }
    setSealed(null);
  }

  async function copyText(text: string, label: string) {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(`${label} copied.`);
    } catch {
      toast.error('Copy failed. Select the text and copy manually.');
    }
  }

  function appendSafeClause(clause: string) {
    setClauseText(prev => {
      const trimmed = prev.trim();
      if (trimmed.includes(clause)) return prev;
      return trimmed ? `${trimmed}\n\n${clause}` : clause;
    });
    toast.success('Protective wording added to your draft.');
  }

  function openInEditor() {
    const {scope} = buildGuidedScope({
      packId: SCENARIO_TO_PACK[scenario],
      jurisdiction,
      subject,
      party: partyName,
      amount: numericAmount,
      date,
      extra: notes.trim() || undefined,
    });
    try {
      sessionStorage.setItem(GUIDED_STASH_KEY, JSON.stringify(scope));
      router.push('/?guided=1');
    } catch {
      toast.error('Could not open editor draft in this browser.');
    }
  }

  async function sealUnilateralRecord() {
    setSealing(true);
    try {
      const result = await sealEvidenceText(ladder.level3Unilateral.noticeTemplate);
      setSealed(result);
      toast.success('Timestamped evidence fingerprint created locally.');
    } catch {
      toast.error('Could not compute SHA-256 in this browser.');
    } finally {
      setSealing(false);
    }
  }

  const riskLabel =
    report.riskLevel === 'high'
      ? 'High dispute risk'
      : report.riskLevel === 'moderate'
        ? 'Needs tighter terms'
        : 'Well protected';

  return (
    <>
      <Header />
      <main id="content" tabIndex={-1} className="shell shield-page">
        <div className="page-heading">
          <div>
            <p className="eyebrow ruled">Rights &amp; Deposit Shield · No account needed</p>
            <h1>
              Check traps <em>before</em> you pay — even if they won’t sign.
            </h1>
            <p className="tagline">
              Paste a rental clause, WhatsApp catering quote, contractor estimate, or freelance brief. Spot unfair
              deductions under India or US rules, then use the 3-level ladder to lock proof without starting a fight.
            </p>
          </div>
          <div className="actions no-print">
            <button type="button" className="primary" onClick={openInEditor}>
              Build full agreement
              <ArrowRight size={16} aria-hidden="true" />
            </button>
          </div>
        </div>

        {/* Step 1: Scenario & Jurisdiction picker */}
        <section className="editor shield-controls no-print" aria-label="Choose scenario and jurisdiction">
          <div className="shield-scenario-bar" role="group" aria-label="Agreement scenario">
            {SCENARIOS.map(s => (
              <button
                key={s.id}
                type="button"
                className={scenario === s.id ? 'primary' : 'secondary'}
                aria-pressed={scenario === s.id}
                onClick={() => selectScenario(s.id)}
              >
                {s.label}
              </button>
            ))}
          </div>

          <div className="two-col section-gap">
            <label>
              Jurisdiction (laws &amp; deposit deadlines)
              <select
                value={jurisdiction}
                onChange={e => selectJurisdiction(e.target.value as JurisdictionId)}
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
            <div className="shield-scenario-note">
              <p className="eyebrow flush">{report.scenario.parties}</p>
              <p className="quiet">{report.scenario.tagline}</p>
            </div>
          </div>
        </section>

        {/* Step 2: Live Trap Scanner + Statutory Rights */}
        <div className="shield-grid section-gap">
          <section className="editor" aria-labelledby="scanner-heading">
            <div className="step-head">
              <span className="step-num" aria-hidden="true">
                1
              </span>
              <h2 id="scanner-heading" className="h-sub">
                Paste what they sent you
              </h2>
              <span
                className={`stage-chip ${
                  report.riskLevel === 'high'
                    ? 'stage-changes_requested'
                    : report.riskLevel === 'moderate'
                      ? 'stage-awaiting'
                      : 'stage-approved'
                }`}
              >
                {riskLabel} · {report.score}/100
              </span>
            </div>

            <label>
              Agreement clause, WhatsApp quote, or broker message
              <textarea
                rows={5}
                value={clauseText}
                onChange={e => setClauseText(e.target.value)}
                placeholder="Paste any paragraph from a lease, catering quotation, contractor estimate, or client email…"
              />
            </label>

            <div className="actions gap-top no-print">
              <button
                type="button"
                className="secondary"
                onClick={() => setClauseText(report.scenario.sampleClause)}
              >
                <Sparkles size={15} aria-hidden="true" />
                Load risky example
              </button>
              <button type="button" className="help-link" onClick={() => setClauseText('')}>
                Clear text
              </button>
            </div>

            {/* Findings */}
            {report.findings.length > 0 ? (
              <div className="section-gap" aria-live="polite">
                <p className="eyebrow">
                  {report.findings.length} trap{report.findings.length === 1 ? '' : 's'} flagged
                </p>
                <ul className="shield-findings">
                  {report.findings.map(f => (
                    <li key={f.id} className={`shield-finding severity-${f.severity}`}>
                      <div className="shield-finding-head">
                        <ShieldAlert size={18} aria-hidden="true" />
                        <strong>{f.title}</strong>
                      </div>
                      <p className="fine">
                        Matched: <span className="mono">“{f.excerpt}”</span>
                      </p>
                      <p className="shield-body">{f.whyItHurts}</p>
                      <p className="shield-law">
                        <Scale size={14} aria-hidden="true" />
                        <span>{f.legalContext}</span>
                      </p>
                      <div className="shield-fix">
                        <p className="eyebrow flush">Safer wording</p>
                        <p>{f.safeClause}</p>
                        <div className="actions gap-top no-print">
                          <button
                            type="button"
                            className="secondary"
                            onClick={() => void copyText(f.safeClause, 'Safer clause')}
                          >
                            <Copy size={14} aria-hidden="true" />
                            Copy clause
                          </button>
                          <button
                            type="button"
                            className="help-link"
                            onClick={() => appendSafeClause(f.safeClause)}
                          >
                            Add to text above
                          </button>
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              <div className="muted-box section-gap shield-clean" role="status">
                <ShieldCheck size={20} aria-hidden="true" />
                <div>
                  <strong>No obvious predatory trap phrases found in this excerpt.</strong>
                  <p className="fine flush">
                    Check the missing protections and statutory deadlines on the right before transferring money.
                  </p>
                </div>
              </div>
            )}

            {report.missingProtections.length > 0 && (
              <div className="section-gap">
                <p className="eyebrow">Missing protections to add</p>
                <ul className="shield-missing">
                  {report.missingProtections.map(m => (
                    <li key={m.id}>
                      <div>
                        <strong>
                          <AlertTriangle size={14} aria-hidden="true" /> {m.title}
                        </strong>
                        <p className="fine flush">{m.safeClause}</p>
                      </div>
                      <div className="actions no-print">
                        <button
                          type="button"
                          className="secondary"
                          onClick={() => appendSafeClause(m.safeClause)}
                        >
                          Add wording
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </section>

          {/* Right column: Jurisdiction Law Baseline */}
          <aside className="editor shield-law-card" aria-labelledby="law-heading">
            <div className="step-head">
              <span className="step-num" aria-hidden="true">
                2
              </span>
              <h2 id="law-heading" className="h-sub">
                Your baseline in {jRule.label}
              </h2>
            </div>

            <dl className="shield-facts">
              <div>
                <dt>Deposit / advance norm</dt>
                <dd>{jRule.depositCapNote}</dd>
              </div>
              <div>
                <dt>Return window</dt>
                <dd>
                  <strong>{jRule.returnWindowDays} days</strong> — {jRule.returnWindowNote}
                </dd>
              </div>
              <div>
                <dt>Why WhatsApp / email counts</dt>
                <dd>{jRule.electronicEvidenceLaw}</dd>
              </div>
              <div>
                <dt>If they refuse to refund</dt>
                <dd>{jRule.disputeForum}</dd>
              </div>
            </dl>

            <div className="section-gap">
              <p className="eyebrow">Key statutory rules</p>
              <ul className="shield-rights-list">
                {jRule.keyRights.map(r => (
                  <li key={r.title}>
                    <strong>{r.title}</strong>
                    <p>{r.detail}</p>
                    <span className="fine">{r.citation}</span>
                  </li>
                ))}
              </ul>
            </div>

            <p className="fine section-gap">
              Practical legal information for India and US agreements, not formal legal advice. For high-value
              disputes, consult a qualified local lawyer.
            </p>
          </aside>
        </div>

        {/* Step 3: The 3-Level "What If They Won't Sign?" Friction Ladder */}
        <section className="editor section-gap" aria-labelledby="ladder-heading">
          <div className="step-head">
            <span className="step-num" aria-hidden="true">
              3
            </span>
            <h2 id="ladder-heading" className="h-sub">
              What if the landlord or vendor won’t sign a formal contract?
            </h2>
          </div>
          <p className="quiet">
            Most landlords, caterers, and local contractors refuse to sign a 6-page PDF from an unfamiliar app. Use
            the lowest-friction level they will actually accept — every level gives you real leverage later.
          </p>

          <div className="three-col section-gap no-print">
            <label>
              Property / event / project
              <input
                value={subject}
                onChange={e => {
                  setSubject(e.target.value);
                  setSealed(null);
                }}
                placeholder="Flat 402, Palm Grove"
              />
            </label>
            <label>
              Landlord / vendor / client name
              <input
                value={partyName}
                onChange={e => {
                  setPartyName(e.target.value);
                  setSealed(null);
                }}
                placeholder="Rajesh Sharma"
              />
            </label>
            <label>
              Your name
              <input
                value={yourName}
                onChange={e => {
                  setYourName(e.target.value);
                  setSealed(null);
                }}
                placeholder="Your full name"
              />
            </label>
          </div>

          <div className="three-col no-print">
            <label>
              Deposit / agreed amount ({jRule.currency})
              <input
                type="number"
                min={0}
                value={amount}
                onChange={e => {
                  setAmount(e.target.value);
                  setSealed(null);
                }}
              />
            </label>
            <label>
              Move-in / event / start date
              <input
                type="date"
                value={date}
                onChange={e => {
                  setDate(e.target.value);
                  setSealed(null);
                }}
              />
            </label>
            <label>
              UPI UTR / meter reading / extra note <span className="quiet">· optional</span>
              <input
                value={notes}
                onChange={e => {
                  setNotes(e.target.value);
                  setSealed(null);
                }}
                placeholder="e.g. UPI UTR 4291083..., EB meter 1420"
              />
            </label>
          </div>

          <div className="ladder-grid section-gap">
            {/* Level 1 */}
            <article className="ladder-card">
              <div className="ladder-head">
                <MessageCircle size={18} aria-hidden="true" />
                <h3>{ladder.level1WhatsApp.title}</h3>
              </div>
              <p className="fine">{ladder.level1WhatsApp.whyItWorks}</p>
              <pre className="ladder-pre">{ladder.level1WhatsApp.message}</pre>
              <div className="actions gap-top no-print">
                <button
                  type="button"
                  className="primary"
                  onClick={() => void copyText(ladder.level1WhatsApp.message, 'WhatsApp message')}
                >
                  <Copy size={15} aria-hidden="true" />
                  Copy WhatsApp message
                </button>
                <a
                  className="secondary"
                  href={ladder.level1WhatsApp.waHref}
                  target="_blank"
                  rel="noreferrer"
                >
                  Open in WhatsApp
                  <ArrowRight size={15} aria-hidden="true" />
                </a>
              </div>
            </article>

            {/* Level 2 */}
            <article className="ladder-card">
              <div className="ladder-head">
                <FileCheck2 size={18} aria-hidden="true" />
                <h3>{ladder.level2Link.title}</h3>
              </div>
              <p className="fine">{ladder.level2Link.whyItWorks}</p>
              <ul className="ladder-bullets">
                <li>
                  <Check size={14} aria-hidden="true" /> Pre-filled with {jRule.label} return window &amp; exclusions
                </li>
                <li>
                  <Check size={14} aria-hidden="true" /> Zero signup required for the landlord, caterer, or client
                </li>
                <li>
                  <Check size={14} aria-hidden="true" /> Version-locked receipt with tamper-evident verification
                </li>
              </ul>
              <div className="actions gap-top no-print">
                <button type="button" className="primary" onClick={openInEditor}>
                  {ladder.level2Link.actionLabel}
                  <ArrowRight size={15} aria-hidden="true" />
                </button>
                <Link className="secondary" href="/templates">
                  Browse 30-sec packs
                </Link>
              </div>
            </article>

            {/* Level 3 */}
            <article className="ladder-card ladder-card-wide">
              <div className="ladder-head">
                <Fingerprint size={18} aria-hidden="true" />
                <h3>{ladder.level3Unilateral.title}</h3>
              </div>
              <p className="fine">{ladder.level3Unilateral.whyItWorks}</p>

              <div className="two-col gap-top">
                <div>
                  <p className="eyebrow flush">Day-1 / Handover Evidence Checklist</p>
                  <ul className="ladder-bullets">
                    {ladder.level3Unilateral.checklist.map(step => (
                      <li key={step}>
                        <CheckCircle2 size={15} aria-hidden="true" />
                        <span>{step}</span>
                      </li>
                    ))}
                  </ul>
                </div>
                <div>
                  <p className="eyebrow flush">Timestamped Notice / Record</p>
                  <pre className="ladder-pre">{sealed ? sealed.record : ladder.level3Unilateral.noticeTemplate}</pre>
                </div>
              </div>

              {sealed && (
                <div className="muted-box section-gap shield-clean" role="status">
                  <ShieldCheck size={18} aria-hidden="true" />
                  <div>
                    <strong>SHA-256 fingerprint sealed locally</strong>
                    <p className="fine flush mono">
                      {sealed.hash} · {sealed.timestamp}
                    </p>
                  </div>
                </div>
              )}

              <div className="actions gap-top no-print">
                <button
                  type="button"
                  className="primary"
                  disabled={sealing}
                  onClick={() => void sealUnilateralRecord()}
                >
                  <Fingerprint size={15} aria-hidden="true" />
                  {sealing ? 'Sealing…' : sealed ? 'Re-seal SHA-256 record' : 'Seal SHA-256 evidence record'}
                </button>
                <button
                  type="button"
                  className="secondary"
                  onClick={() =>
                    void copyText(
                      sealed ? sealed.record : ladder.level3Unilateral.noticeTemplate,
                      'Evidence record',
                    )
                  }
                >
                  <Copy size={15} aria-hidden="true" />
                  Copy record
                </button>
                <button type="button" className="secondary" onClick={() => window.print()}>
                  <Printer size={15} aria-hidden="true" />
                  Print / Save PDF
                </button>
                <Link className="help-link" href="/verify#evidence-check">
                  Verify a sealed record
                </Link>
              </div>
            </article>
          </div>
        </section>
      </main>
    </>
  );
}
