'use client';
import {useEffect, useState} from 'react';
import {useSearchParams} from 'next/navigation';
import {ShieldAlert, ShieldCheck} from 'lucide-react';
import {label} from '@/lib/scope';
import {api} from '@/app/ui';

type Result = {record: 'match' | 'mismatch' | 'not_found'; signature: 'valid' | 'invalid' | 'unsigned' | null; details: null | {title: string; client: string; version: number; status: string; signer: string | null; decided: string | null; content_sha256: string; kid: string | null; signature: string | null}};

/** Public receipt check: the stored record must still hash to the printed fingerprint and carry a valid signature. */
export function VerifyRecord() {
  const q = useSearchParams();
  const [p, setP] = useState(q.get('p') ?? ''), [v, setV] = useState(q.get('v') ?? ''), [a, setA] = useState(q.get('a') ?? '');
  const [result, setResult] = useState<Result | null>(null), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  async function check(project = p, version = v, anchor = a) {
    setError(''); setResult(null); setBusy(true);
    try { setResult(await api(`/api/verify?p=${encodeURIComponent(project.trim())}&v=${encodeURIComponent(version.trim())}&a=${encodeURIComponent(anchor.trim())}`)); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  useEffect(() => { const project = q.get('p'), version = q.get('v'), anchor = q.get('a'); if (project && version && anchor) queueMicrotask(() => { void check(project, version, anchor); }); // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);
  const good = result?.record === 'match' && result.signature === 'valid';
  const d = result?.details;
  return (
    <section className="editor">
      <p className="eyebrow">RECEIPT CHECK</p>
      <h1>Verify a Scopeflow receipt</h1>
      <p className="quiet section-gap">Scan the QR code on a PDF receipt, or enter the project id, version and record fingerprint printed on it.</p>
      {result && (
        <div className="muted-box" role="status" data-verdict={good ? 'valid' : 'invalid'}>
          {good ? <p className="chain ok"><ShieldCheck size={16} /> Verified: the stored record matches this fingerprint and carries a valid Scopeflow signature.</p>
            : result.record === 'match' && result.signature === 'unsigned' ? <p className="chain unsigned"><ShieldAlert size={16} /> The record matches, but it was not signed (signing was not configured when it was decided).</p>
            : result.record === 'match' ? <p className="chain bad"><ShieldAlert size={16} /> The record matches its fingerprint but its signature does not verify. Treat this record as altered.</p>
            : result.record === 'mismatch' ? <p className="chain bad"><ShieldAlert size={16} /> Not verified: the stored record no longer matches this fingerprint, or the fingerprint was mistyped.</p>
            : <p className="chain bad"><ShieldAlert size={16} /> No decided record exists for this project and version.</p>}
          {d && <dl className="verify-details">
            <dt>Scope</dt><dd>{d.title} · {d.client}</dd>
            <dt>Version</dt><dd>{d.version} · {label(d.status)}</dd>
            <dt>Signer (as typed)</dt><dd>{d.signer ?? '—'}</dd>
            <dt>Decided</dt><dd>{d.decided ? `${d.decided.replace('T', ' ').replace(/\.\d+Z$/, ' UTC')} (${new Date(d.decided).toLocaleString(undefined, {timeZoneName: 'short'})})` : '—'}</dd>
            <dt>Content SHA-256</dt><dd className="mono">{d.content_sha256}</dd>
            <dt>Signature</dt><dd className="mono">{d.signature ?? 'none'}</dd>
          </dl>}
          <p className="fine">Compare these details with the printed receipt. This check confirms integrity, not the signer’s identity.</p>
        </div>
      )}
      {error && <p className="error" role="alert">{error}</p>}
      <label>Project id<input value={p} onChange={e => setP(e.target.value)} maxLength={80} /></label>
      <label>Version<input value={v} onChange={e => setV(e.target.value)} inputMode="numeric" maxLength={6} /></label>
      <label>Record fingerprint<input className="mono" value={a} onChange={e => setA(e.target.value)} maxLength={64} /></label>
      <div className="actions"><button className="primary" disabled={busy || !p || !v || a.trim().length !== 64} onClick={() => check()}>{busy ? 'Checking…' : 'Verify'}</button></div>
    </section>
  );
}
