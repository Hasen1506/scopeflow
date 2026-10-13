'use client';
import {useEffect, useState} from 'react';
import {useSearchParams} from 'next/navigation';
import {ShieldAlert, ShieldCheck} from 'lucide-react';
import {label} from '@/lib/scope';
import {chipWording, parseReceiptInput, sealStatus} from '@/lib/evidence';
import {api} from '@/app/ui';

type Result = {
  record: 'match' | 'mismatch' | 'not_found';
  signature: 'valid' | 'legacy_key' | 'unknown_key' | 'invalid' | 'unsigned' | null;
  anchor?: string;
  evidence?: {chip: string; line: string};
  details: null | {title: string; client: string; version: number; status: string; signer: string | null; decided: string | null; content_sha256: string; kid: string | null; signature: string | null; code_to?: string | null; owner_session?: boolean};
};
const FINGERPRINT = /^([a-f0-9]{64}|[a-f0-9]{16})$/;

/** Why the Verify button is disabled, in words (LT-09), or '' when it can run. */
function missing(p: string, v: string, a: string) {
  if (!p.trim()) return 'Enter the project id printed on the receipt.';
  if (!/^\d{1,6}$/.test(v.trim())) return 'Enter the version number (a whole number).';
  if (!FINGERPRINT.test(a.trim().toLowerCase())) return 'Enter the record fingerprint: all 64 characters, or the first 16 shown on the review page.';
  return '';
}

/** Public receipt check: the stored record must still hash to the printed fingerprint and carry a valid seal. */
export function VerifyRecord() {
  const q = useSearchParams();
  const [p, setP] = useState(q.get('p') ?? ''), [v, setV] = useState(q.get('v') ?? ''), [a, setA] = useState(q.get('a') ?? '');
  const [result, setResult] = useState<Result | null>(null), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const [receipt, setReceipt] = useState(''), [receiptError, setReceiptError] = useState('');
  async function check(project = p, version = v, anchor = a) {
    setError(''); setResult(null); setBusy(true);
    try { setResult(await api(`/api/verify?p=${encodeURIComponent(project.trim())}&v=${encodeURIComponent(version.trim())}&a=${encodeURIComponent(anchor.trim().toLowerCase())}`)); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  useEffect(() => { const project = q.get('p'), version = q.get('v'), anchor = q.get('a'); if (project && version && anchor) queueMicrotask(() => { void check(project, version, anchor); }); // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);
  // QA-02: a pasted receipt (JSON, verify link or fingerprint) is checked here, inline; anything else is refused without navigating.
  function checkReceipt() {
    const r = parseReceiptInput(receipt);
    if (r.kind === 'invalid') { setReceiptError(r.error); return; }
    setReceiptError('');
    if (r.kind === 'fingerprint') { setA(r.a); if (!p.trim() || !v.trim()) { setReceiptError('Fingerprint added below. Now enter the project id and version printed on the receipt.'); return; } void check(p, v, r.a); return; }
    setP(r.p); setV(String(r.v)); setA(r.a); void check(r.p, String(r.v), r.a);
  }
  const status = result?.record === 'match' ? sealStatus(result.signature) : null;
  const good = status === 'dedicated' || status === 'legacy_key';
  const d = result?.details;
  const why = missing(p, v, a);
  return (
    <section className="editor">
      <p className="eyebrow">RECEIPT CHECK</p>
      <h1>Verify a Scopeflow receipt</h1>
      <p className="quiet section-gap">Scan the QR code on a PDF receipt, use “Verify this record” on the review page, or enter the project id, version and record fingerprint printed on it.</p>
      {result && (
        <div className="muted-box" role="status" data-verdict={good ? 'valid' : 'invalid'} data-seal={status ?? 'none'}>
          {good ? <p className="chain ok"><ShieldCheck size={16} /> {result.evidence?.chip ?? chipWording(status!)}: the stored record matches this fingerprint{status === 'legacy_key' ? ' and carries a seal from an earlier ScopeFlow key.' : ' and carries a valid ScopeFlow seal.'}</p>
            : result.record === 'match' && status === 'unsigned' ? <p className="chain unsigned"><ShieldAlert size={16} /> {chipWording('unsigned')}: the record matches, but it was saved before sealing was on.</p>
            : result.record === 'match' && result.signature === 'unknown_key' ? <p className="chain bad"><ShieldAlert size={16} /> The record matches its fingerprint, but its seal is from a key this server no longer trusts.</p>
            : result.record === 'match' ? <p className="chain bad"><ShieldAlert size={16} /> The record matches its fingerprint but its seal does not verify. Treat this record as altered.</p>
            : result.record === 'mismatch' ? <p className="chain bad"><ShieldAlert size={16} /> Not verified: the stored record no longer matches this fingerprint, or the fingerprint was mistyped.</p>
            : <p className="chain bad"><ShieldAlert size={16} /> No decided record exists for this project and version.</p>}
          {result.evidence && result.record === 'match' && <p className="fine">{result.evidence.line}</p>}
          {d && <dl className="verify-details">
            <dt>Scope</dt><dd>{d.title} · {d.client}</dd>
            <dt>Version</dt><dd>{d.version} · {label(d.status)}</dd>
            <dt>Name typed by the person deciding</dt><dd>{d.signer ?? '—'}</dd>
            {d.code_to && <><dt>Identity check</dt><dd>Code verified to {d.code_to}</dd></>}
            {d.owner_session && <><dt>Note</dt><dd>⚠ Submitted from a browser signed in to the creator’s account.</dd></>}
            <dt>Decided</dt><dd>{d.decided ? `${d.decided.replace('T', ' ').replace(/\.\d+Z$/, ' UTC')} (${new Date(d.decided).toLocaleString(undefined, {timeZoneName: 'short'})})` : '—'}</dd>
            {result.anchor && <><dt>Record fingerprint</dt><dd className="mono">{result.anchor}</dd></>}
            <dt>Content SHA-256</dt><dd className="mono">{d.content_sha256}</dd>
            <dt>Seal</dt><dd className="mono">{d.signature ?? 'none'}</dd>
          </dl>}
          <p className="fine">Compare these details with the printed receipt. This check confirms the record is unchanged; it does not confirm who approved it.</p>
        </div>
      )}
      {error && <p className="error" role="alert">{error}</p>}
      <label>Paste a receipt<textarea rows={2} value={receipt} onChange={e => { setReceipt(e.target.value); setReceiptError(''); }} aria-invalid={receiptError ? true : undefined} aria-describedby={receiptError ? 'receipt-error' : undefined} placeholder="Receipt JSON, verify link or fingerprint" /></label>
      {receiptError && <p className="error" role="alert" id="receipt-error">{receiptError}</p>}
      <div className="actions"><button className="secondary" onClick={checkReceipt} disabled={!receipt.trim()}>Check receipt</button></div>
      <label>Project id<input value={p} onChange={e => setP(e.target.value)} maxLength={80} /></label>
      <label>Version<input value={v} onChange={e => setV(e.target.value)} inputMode="numeric" maxLength={6} /></label>
      <label>Record fingerprint<input className="mono" value={a} onChange={e => setA(e.target.value)} maxLength={64} /></label>
      <div className="actions"><button className="primary" disabled={busy || !!why} aria-describedby={why ? 'verify-why' : undefined} onClick={() => check()}>{busy ? 'Checking…' : 'Verify'}</button></div>
      {why && <p className="fine" id="verify-why">{why}</p>}
    </section>
  );
}
