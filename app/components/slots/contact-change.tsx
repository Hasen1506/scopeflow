'use client';
// Slot: ContactChange. Owner: WS-02 (implements it). Mounted by: WS-09 (workspace project settings).
// C5 (§6.2.3): once a version was sent the client contact is locked; this is the explicit two-step
// change. The old address is told, the change is a signed record in the client's timeline, and it
// needs a fresh sign-in (M16).
import {useState} from 'react';
import {api, post} from '@/app/ui';
import styles from '../evidence/identity-slots.module.css';

export type ContactChangeProps = {
  projectId: string;
  /** Current contact, as GET /api/scopes/<id> returns it (owner view). */
  clientEmail: string; clientPhone: string;
  /** project.contact_locked from GET /api/scopes/<id>. */
  locked: boolean;
  onChanged?: () => void | Promise<void>;
};

export default function ContactChange({projectId, clientEmail, clientPhone, locked, onChanged}: ContactChangeProps) {
  const [field, setField] = useState<'email' | 'phone'>('email');
  const [value, setValue] = useState(''), [reason, setReason] = useState(''), [step, setStep] = useState<'edit' | 'confirm'>('edit');
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [done, setDone] = useState('');
  const current = field === 'email' ? clientEmail : clientPhone;
  async function confirm() {
    setError(''); setBusy(true);
    try {
      const r = await api(`/api/scopes/${projectId}/contact-change`, post({[field]: value.trim(), reason: reason.trim(), confirm: true}));
      setDone(`Changed. ${r.notice?.to ? `A notice went to the old address (${r.notice.to}).` : ''} The change is recorded and shown to your client.`);
      setStep('edit'); setValue(''); setReason('');
      await onChanged?.();
    } catch (e) {
      const err = e as Error & {code?: string};
      setError(err.code === 'reauth_required' ? 'For your security, sign out and sign in again, then confirm within 10 minutes.' : err.message);
    } finally { setBusy(false); }
  }
  return (
    <section className={styles.panel} aria-labelledby="h-contact-change">
      <h3 id="h-contact-change">Change client contact</h3>
      <p className={styles.locked}>{locked ? 'Locked: this project was already sent, so the address codes and notices go to can only change here. The old address is told about the change.' : 'Not sent yet: you can still edit the contact in the project settings, or change it here with a recorded notice.'}</p>
      {done && <p className="chain ok" role="status">{done}</p>}
      {step === 'edit' ? <>
        <label>Change<select value={field} onChange={e => setField(e.target.value as 'email' | 'phone')}><option value="email">Email</option><option value="phone">Phone</option></select></label>
        <p className="fine">Current: {current || 'none'}</p>
        <label>New {field}<input value={value} onChange={e => setValue(e.target.value)} inputMode={field === 'phone' ? 'tel' : 'email'} placeholder={field === 'phone' ? '+919876543210' : 'client@example.com'} /></label>
        <label>Reason (the old address sees it)<input value={reason} maxLength={300} onChange={e => setReason(e.target.value)} /></label>
        <div className="actions"><button className="secondary" disabled={!value.trim() || reason.trim().length < 3} onClick={() => { setError(''); setStep('confirm'); }}>Review change</button></div>
      </> : <>
        <p>Change the client {field} from <strong>{current || 'none'}</strong> to <strong>{value.trim()}</strong>? {current ? 'A notice goes to the old address now.' : ''} Later receipts show the new address as “on file since” today.</p>
        <div className="actions"><button className="primary" disabled={busy} onClick={confirm}>{busy ? 'Changing…' : 'Confirm change'}</button><button className="secondary" disabled={busy} onClick={() => setStep('edit')}>Back</button></div>
      </>}
      {error && <p className="error" role="alert">{error}</p>}
    </section>
  );
}
