'use client';
// Slot: MsmedTerms. Owner: WS-03 (implements it). Mounted by: WS-09 (workspace); used by app/invoice-panel.tsx.
// MSMED Act payment terms (SF-07): the owner's Udyam registration, the written payment period
// (at most 45 days from acceptance), the interest-rate basis, and the delivery / acceptance record
// that starts the clock. Shows the clause for micro and small suppliers and every warning.
import {useCallback, useEffect, useId, useState} from 'react';
import {toast} from 'sonner';
import styles from '../ws03-slots.module.css';
import {api, post} from '@/app/ui';

type Msme = {udyam_number: string; registered_on: string; category: 'micro' | 'small' | 'medium'};
type Terms = {msme_profile: Msme | null; msmed: {agreed_days: number | null; rate_basis: 'on_due_date' | 'per_period'; clause: string | null; warnings: {code: string; message: string}[]; disclaimer: string}};
type Acceptance = {acceptance: {day: string | null; basis: string; delivered_on: string | null} | null; pay_by: string | null; interest_total: number};
export type MsmedTermsProps = {projectId: string; disabled?: boolean; onChanged?: () => void};

export default function MsmedTerms({projectId, disabled, onChanged}: MsmedTermsProps) {
  const id = useId();
  const [t, setT] = useState<Terms | null>(null);
  const [acc, setAcc] = useState<Acceptance | null>(null);
  const [udyam, setUdyam] = useState<Msme>({udyam_number: '', registered_on: '', category: 'micro'});
  const [days, setDays] = useState('');
  const [delivered, setDelivered] = useState('');
  const [accepted, setAccepted] = useState('');
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => Promise.all([
    api(`/api/scopes/${projectId}/invoices/terms`).then((d: Terms) => { setT(d); if (d.msme_profile) setUdyam(d.msme_profile); setDays(d.msmed.agreed_days ? String(d.msmed.agreed_days) : ''); }),
    api(`/api/scopes/${projectId}/acceptance`).then(setAcc, () => setAcc(null)),
  ]).catch(() => {}), [projectId]);
  useEffect(() => { void load(); }, [load]);
  async function save(e: React.FormEvent) {
    e.preventDefault(); setBusy(true);
    try {
      const body = {msme_profile: udyam.udyam_number ? udyam : null, msmed: {agreed_days: days ? Number(days) : null, rate_basis: t?.msmed.rate_basis ?? 'on_due_date'}};
      setT(await api(`/api/scopes/${projectId}/invoices/terms`, {...post(body), method: 'PUT'})); toast.success('MSMED terms saved.'); onChanged?.();
    } catch (err) { toast.error((err as Error).message); } finally { setBusy(false); }
  }
  async function record(e: React.FormEvent) {
    e.preventDefault(); setBusy(true);
    try { setAcc(await api(`/api/scopes/${projectId}/acceptance`, post({delivered_on: delivered, accepted_on: accepted || null}))); toast.success('Delivery and acceptance recorded.'); onChanged?.(); }
    catch (err) { toast.error((err as Error).message); } finally { setBusy(false); }
  }
  if (!t) return null;
  return (
    <details className="disclosure">
      <summary>MSMED Act terms <span className="quiet">· {t.msme_profile ? `${t.msme_profile.category} enterprise, ${t.msme_profile.udyam_number}` : 'add your Udyam registration'}</span></summary>
      <div className={styles.box}>
        <form aria-label="MSMED terms" onSubmit={save}>
          <div className={styles.row}>
            <label htmlFor={id + '-u'}>Udyam number<input id={id + '-u'} placeholder="UDYAM-TN-02-0012345" disabled={disabled} value={udyam.udyam_number} onChange={e => setUdyam({...udyam, udyam_number: e.target.value.toUpperCase()})} /></label>
            <label htmlFor={id + '-d'}>Registered on<input id={id + '-d'} type="date" disabled={disabled} value={udyam.registered_on} onChange={e => setUdyam({...udyam, registered_on: e.target.value})} /></label>
            <label htmlFor={id + '-c'}>Category<select id={id + '-c'} disabled={disabled} value={udyam.category} onChange={e => setUdyam({...udyam, category: e.target.value as Msme['category']})}><option value="micro">Micro</option><option value="small">Small</option><option value="medium">Medium</option></select></label>
            <label htmlFor={id + '-p'}>Payment within (days of acceptance)<input id={id + '-p'} type="number" min={1} max={45} placeholder="15 if none agreed" disabled={disabled} value={days} onChange={e => setDays(e.target.value)} /></label>
          </div>
          <div className="actions"><button className="secondary" type="submit" disabled={busy || disabled}>Save MSMED terms</button></div>
        </form>
        {t.msmed.clause && <p className={styles.clause}>{t.msmed.clause}</p>}
        {t.msmed.warnings.map(w => <p key={w.code} className={styles.warn} role="note">{w.message}</p>)}
        <form aria-label="Delivery and acceptance" onSubmit={record}>
          <div className={styles.row}>
            <label htmlFor={id + '-dl'}>Delivered on<input id={id + '-dl'} type="date" required disabled={disabled} value={delivered} onChange={e => setDelivered(e.target.value)} /></label>
            <label htmlFor={id + '-ac'}>Accepted in writing on <span className="quiet">· optional</span><input id={id + '-ac'} type="date" disabled={disabled} value={accepted} onChange={e => setAccepted(e.target.value)} /></label>
          </div>
          <div className="actions"><button className="secondary" type="submit" disabled={busy || disabled}>Record delivery</button></div>
        </form>
        {acc?.acceptance && <p className="fine">Acceptance: {acc.acceptance.day ?? 'not yet'} ({acc.acceptance.basis}){acc.pay_by ? ` · payment due by ${acc.pay_by}` : ''}.</p>}
        <p className={styles.banner} role="note">{t.msmed.disclaimer} Interest under s.16 is compound with monthly rests at three times the RBI Bank Rate. <a className="help-link" href="/msme-interest">Interest calculator</a> · <a className="help-link" href={`/api/scopes/${projectId}/dispute-pack?variant=msmed`} download>MSMED pack (ZIP)</a></p>
      </div>
    </details>
  );
}
