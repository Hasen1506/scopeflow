'use client';
import {useState} from 'react';
import {PenLine} from 'lucide-react';
import {sha256} from '@/lib/ledger';
import type {Scope} from '@/lib/scope';
import {formatInZone} from '@/lib/time';
import {Checkbox} from '@/components/ui/checkbox';
import {api, post} from '@/app/ui';
import {OtpGate} from './otp-gate';

export type CosignState = {roles: {id: string; role: string; cosign: null | {signer: string; signed: string; signature: string | null}}[]; waiting: number; complete: boolean};
type Identity = {method: string; to: string | null; channel?: 'email' | 'sms' | 'whatsapp'} | null;

/** Countersignatures the creator asked for after approval (e.g. a finance approver). Each role signs once. */
export function Countersign({token, content, version, state, timeZone, identity, otpSession, onOtpVerified, onSigned}: {
  token: string; content: Scope; version: number; state: CosignState; timeZone: string;
  identity: Identity; otpSession: string; onOtpVerified: (s: string) => void; onSigned: () => Promise<void>;
}) {
  const waiting = state.roles.filter(r => !r.cosign);
  const [roleId, setRoleId] = useState(waiting[0]?.id ?? ''), [name, setName] = useState(''), [checked, setChecked] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('');
  async function sign() {
    setError('');
    if (name.trim().length < 2) return setError('Enter your name to countersign.');
    if (!checked) return setError('Confirm that you reviewed this version before signing.');
    if (identity && !otpSession) return setError('Confirm the code first.');
    setBusy(true);
    try { await api(`/api/review/${token}/cosign`, post({cosigner_id: roleId, signer: name, acknowledged: true, content_sha256: await sha256(JSON.stringify(content)), ...(otpSession ? {otp_session: otpSession} : {})})); setName(''); setChecked(false); await onSigned(); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  return (
    <section className="editor no-print cosign-box" aria-labelledby="h-cosign">
      <h2 id="h-cosign"><PenLine size={18} aria-hidden="true" /> Countersignatures</h2>
      <p className="quiet section-gap">{state.complete ? 'Every role the creator asked for has countersigned this approved version.' : `The creator asks ${state.roles.length === 1 ? 'one more role' : 'these roles'} to countersign the approved version. The approval itself does not change.`}</p>
      <ul className="cosign-list">
        {state.roles.map(r => <li key={r.id}><strong>{r.role}</strong>{r.cosign ? <span className="tag status-approved">Signed by {r.cosign.signer} · {formatInZone(r.cosign.signed, timeZone)}</span> : <span className="tag status-pending">Waiting</span>}</li>)}
      </ul>
      {waiting.length > 0 && <div className="section-gap">
        {identity && <OtpGate token={token} to={identity.to} channel={identity.channel} session={otpSession} onVerified={onOtpVerified} purpose="a countersignature" />}
        {waiting.length > 1 && <label>Signing as<select value={roleId} onChange={e => setRoleId(e.target.value)}>{waiting.map(r => <option key={r.id} value={r.id}>{r.role}</option>)}</select></label>}
        <label>Your name{waiting.length === 1 ? <span className="quiet"> · signing as {waiting[0].role}</span> : null}<input maxLength={120} value={name} onChange={e => setName(e.target.value)} /></label>
        <label className="consent"><Checkbox checked={checked} onCheckedChange={v => setChecked(v === true)} />I have reviewed version {version} and countersign it as {waiting.find(r => r.id === roleId)?.role ?? waiting[0].role}.</label>
        {error && <p className="error" role="alert">{error}</p>}
        <div className="actions"><button className="primary" disabled={busy || (!!identity && !otpSession)} onClick={sign}>{busy ? 'Signing…' : 'Countersign'}</button></div>
      </div>}
    </section>
  );
}
