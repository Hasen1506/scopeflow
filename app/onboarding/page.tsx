'use client';
import Link from 'next/link';
import {useRouter} from 'next/navigation';
import {useEffect, useMemo, useRef, useState} from 'react';
import QRCode from 'qrcode';
import {Header, api} from '../ui';
import {currencyList} from '@/lib/currency';
import {COUNTRIES, UDYAM_CATEGORIES, countryDefaults, countryFromLocale, onboardingSuggestions} from '@/lib/profile';
import {checkGstin} from '@/lib/gstin';
import {isValidVpa, upiLink, VPA_MESSAGE} from '@/lib/vpa';
import {MODES, MODE_BLURB, MODE_LABEL, type Mode} from '@/lib/mode-core';
import {safeReturnPath} from '@/lib/origin';
import TimezoneSelect from '@/app/components/slots/timezone-select';

// LT-04/SF-11: first-run onboarding in three steps: (1) workspace mode, (2) country, currency and
// time zone, (3) business details: GSTIN (optional), Udyam (optional), UPI ID. Defaults come
// from the browser's locale (en-IN → India, INR, Asia/Kolkata) and are all editable here and later
// in Account. GST at 18% is only suggested when a GSTIN is given; payment terms cite MSMED s.15
// for Udyam micro and small units.
export default function Onboarding() {
  const router = useRouter();
  const [step, setStep] = useState(1), [busy, setBusy] = useState(false), [error, setError] = useState(''), [signedOut, setSignedOut] = useState(false);
  const [mode, setMode] = useState<Mode>('freelancer');
  // U6: the server default only fills the mode until the user picks one themselves.
  const modeTouched = useRef(false);
  const [country, setCountry] = useState('OTHER'), [currency, setCurrency] = useState('USD'), [timezone, setTimezone] = useState('UTC');
  const [name, setName] = useState(''), [gstin, setGstin] = useState(''), [vpa, setVpa] = useState('');
  const [udyam, setUdyam] = useState({number: '', date: '', category: ''});
  const [gst, setGst] = useState(true), [terms, setTerms] = useState(''), [termsTouched, setTermsTouched] = useState(false);
  const [qr, setQr] = useState<string | null>(null);
  useEffect(() => {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone, c = countryFromLocale(navigator.language, tz), d = countryDefaults(c);
    queueMicrotask(() => { setCountry(c); setCurrency(d.currency); setTimezone(c === 'OTHER' && tz ? tz : d.timezone); });
    api('/api/me').then(m => { if (!m.signedIn) setSignedOut(true); else if (m.defaults?.mode && !modeTouched.current) setMode(m.defaults.mode); }, () => {});
  }, []);
  const india = country === 'IN';
  const g = gstin ? checkGstin(gstin) : null;
  const suggestions = useMemo(() => onboardingSuggestions({country, gstin: g?.ok ? gstin : '', udyam_category: udyam.category}), [country, gstin, g?.ok, udyam.category]);
  const shownTerms = termsTouched ? terms : suggestions.payment_terms;
  const link = vpa && isValidVpa(vpa) ? upiLink({vpa, name}) : null;
  useEffect(() => { let live = true; if (!link) { queueMicrotask(() => setQr(null)); return; } QRCode.toDataURL(link, {margin: 1, width: 148}).then(u => { if (live) setQr(u); }, () => {}); return () => { live = false; }; }, [link]);
  function pickCountry(c: string) { const d = countryDefaults(c); setCountry(c); setCurrency(d.currency); setTimezone(d.timezone); if (c !== 'IN') { setGstin(''); setUdyam({number: '', date: '', category: ''}); } }
  async function finish() {
    if (busy) return;
    setBusy(true); setError('');
    try {
      await api('/api/profile/onboarding', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({
        mode, country, currency, timezone, business_name: name, gstin: india ? gstin : '', upi_vpa: vpa,
        udyam_number: india ? udyam.number : '', udyam_date: india ? udyam.date : '', udyam_category: india ? udyam.category : '',
        tax_label: g?.ok && gst ? 'GST' : '', tax_pct: g?.ok && gst ? 18 : null, payment_terms: shownTerms,
      })});
      router.push(safeReturnPath(new URLSearchParams(location.search).get('return_to') ?? '/'));
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  const stepOk = step !== 3 || ((!gstin || !!g?.ok) && (!vpa || !!link));
  return <><Header/><main id="content" tabIndex={-1} className="review-shell policy"><section className="editor">
    <p className="eyebrow">SET UP YOUR WORKSPACE · STEP {step} OF 3</p>
    <h1>{step === 1 ? <>How will you <em>use ScopeFlow?</em></> : step === 2 ? <>Where do you <em>work?</em></> : <>Your business <em>details.</em></>}</h1>
    {signedOut && <p className="muted-box" role="status">Sign in first: <Link className="help-link" href="/auth/sign-in?return_to=%2Fonboarding">Sign in</Link></p>}
    {step === 1 && <fieldset className="section-gap"><legend>Workspace mode</legend><p className="fine">You can change it any time in Account. Every feature stays available in every mode.</p>
      {MODES.map(m => <label key={m} className="radio-row"><input type="radio" name="mode" value={m} checked={mode === m} onChange={() => { modeTouched.current = true; setMode(m); }}/> <span><strong>{MODE_LABEL[m]}</strong><span className="quiet block">{MODE_BLURB[m]}</span></span></label>)}</fieldset>}
    {step === 2 && <div>
      <label>Country<select value={country} onChange={e => pickCountry(e.target.value)}>{COUNTRIES.map(c => <option key={c.code} value={c.code}>{c.name}</option>)}</select></label>
      <label>Currency for new scopes<select value={currency} onChange={e => setCurrency(e.target.value)}>{currencyList.map(c => <option key={c.code} value={c.code}>{c.code} · {c.name}</option>)}</select></label>
      <TimezoneSelect value={timezone} onChange={setTimezone} label="Time zone"/>
    </div>}
    {step === 3 && <div>
      <label>Business or trading name <span className="quiet">· printed on invoices</span><input maxLength={120} value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Ada Studio"/></label>
      {india && <>
        <label htmlFor="ob-gstin">GSTIN <span className="quiet">· optional</span></label>
        <input id="ob-gstin" maxLength={15} value={gstin} onChange={e => setGstin(e.target.value.toUpperCase().trim())} aria-invalid={g && !g.ok ? true : undefined} aria-describedby="ob-gstin-hint" placeholder="27AAPFU0939F1ZV"/>
        <span id="ob-gstin-hint" className={g && !g.ok ? 'error block' : 'fine block'}>{g ? (g.ok ? `Valid · registered in state ${g.state}` : g.message) : 'Leave empty if you are not GST-registered.'}</span>
        {g?.ok && <label className="radio-row"><input type="checkbox" checked={gst} onChange={e => setGst(e.target.checked)}/> Add GST at 18% to new scopes <span className="quiet">· a suggestion; change it per scope</span></label>}
        <fieldset className="section-gap"><legend>Udyam registration <span className="quiet">· optional</span></legend>
          <div className="three-col"><label>Udyam number<input maxLength={19} value={udyam.number} onChange={e => setUdyam(u => ({...u, number: e.target.value.toUpperCase()}))} placeholder="UDYAM-TN-02-0012345"/></label>
          <label>Registration date<input type="date" value={udyam.date} onChange={e => setUdyam(u => ({...u, date: e.target.value}))}/></label>
          <label>Category<select value={udyam.category} onChange={e => setUdyam(u => ({...u, category: e.target.value}))}><option value="">Not registered</option>{UDYAM_CATEGORIES.map(c => <option key={c} value={c}>{c[0].toUpperCase() + c.slice(1)}</option>)}</select></label></div>
        </fieldset>
      </>}
      <label htmlFor="ob-vpa">UPI ID <span className="quiet">· clients can pay you directly</span></label>
      <input id="ob-vpa" maxLength={320} value={vpa} onChange={e => setVpa(e.target.value.trim())} aria-invalid={vpa && !link ? true : undefined} aria-describedby="ob-vpa-hint" placeholder="yourname@okbank"/>
      <span id="ob-vpa-hint" className={vpa && !link ? 'error block' : 'fine block'}>{vpa && !link ? VPA_MESSAGE : 'Optional. Shown to clients as a UPI QR code.'}</span>
      {qr && <img src={qr} width={148} height={148} alt={`UPI QR code to pay ${vpa}`}/>}
      <label>Payment terms for new scopes<input maxLength={500} value={shownTerms} onChange={e => { setTerms(e.target.value); setTermsTouched(true); }}/></label>
    </div>}
    {error && <p className="error" role="alert">{error}</p>}
    <div className="actions section-gap">
      {step > 1 && <button className="secondary" disabled={busy} onClick={() => setStep(s => s - 1)}>Back</button>}
      {step < 3 ? <button className="primary" onClick={() => setStep(s => s + 1)}>Next</button> : <button className="primary" disabled={busy || !stepOk || signedOut} onClick={() => void finish()}>{busy ? 'Saving…' : 'Finish setup'}</button>}
      <Link className="help-link" href="/">Skip for now</Link>
    </div>
  </section></main></>;
}
