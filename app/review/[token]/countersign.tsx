'use client';
import {useState} from 'react';
import {PenLine} from 'lucide-react';
import type {Scope} from '@/lib/scope';
import {contentFingerprint} from '@/lib/evidence';
import {formatInZone} from '@/lib/time';
import {Checkbox} from '@/components/ui/checkbox';
import {api, post} from '@/app/ui';
import {OtpGate} from './otp-gate';

export type CosignRole = {id: string; role: string; cosign: null | {signer: string; signed: string; signature: string | null; verified_to?: string | null}};
export type CosignState = {roles: CosignRole[]; waiting: number; complete: boolean};
type Identity = {method: string; to: string | null; channel?: 'email' | 'sms' | 'whatsapp'} | null;

const signedLine = (r: CosignRole, timeZone: string) => r.cosign ? `${r.role}: countersigned by ${r.cosign.signer}${r.cosign.verified_to ? ` (code verified to ${r.cosign.verified_to})` : ''} · ${formatInZone(r.cosign.signed, timeZone)}` : `${r.role}: waiting`;

/**
 * Countersignatures on the client's page (WS-07 mounts it). H1: roles never sign through the
 * client link; each role signs on its own link with a code to its own address. The client page
 * only shows who signed and where their code went. The other props are kept for WS-07's mount.
 */
export function Countersign({state, timeZone}: {
  token?: string; content?: Scope; version?: number; state: CosignState; timeZone: string;
  identity?: Identity; otpSession?: string; onOtpVerified?: (s: string) => void; onSigned?: () => Promise<void>;
}) {
  return (
    <section className="editor no-print cosign-box" aria-labelledby="h-cosign">
      <h2 id="h-cosign"><PenLine size={18} aria-hidden="true" /> Countersignatures</h2>
      <p className="quiet section-gap">{state.complete ? 'Every role the creator asked for has countersigned this approved version.' : 'The creator asked these roles to countersign the approved version. Each one signs on their own link, with a code sent to their own address. The approval itself does not change.'}</p>
      <ul className="cosign-list">
        {state.roles.map(r => <li key={r.id} data-role={r.id}><strong>{r.role}</strong> <span className={'tag ' + (r.cosign ? 'status-approved' : 'status-pending')}>{signedLine(r, timeZone)}</span></li>)}
      </ul>
    </section>
  );
}

/** One role signing on its own link (/cosign/<token>). */
export function CosignForm({token, content, version, role, timeZone, identity, onSigned}: {
  token: string; content: Scope; version: number; role: {id: string; role: string; name: string | null}; timeZone: string;
  identity: Identity; onSigned: (result: {signer: string; signed: string; verified_to?: string | null}) => void;
}) {
  const [name, setName] = useState(role.name ?? ''), [checked, setChecked] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState(''), [session, setSession] = useState('');
  async function sign() {
    setError('');
    if (name.trim().length < 2) return setError('Enter your name to countersign.');
    if (!checked) return setError('Confirm that you reviewed this version before signing.');
    if (identity && !session) return setError('Confirm the code first.');
    setBusy(true);
    try {
      const r = await api(`/api/cosign/${token}`, post({signer: name, acknowledged: true, content_sha256: await contentFingerprint(content), ...(session ? {otp_session: session} : {})}));
      onSigned(r.cosign);
    } catch (e) { setSession(''); setError((e as Error).message); } finally { setBusy(false); }
  }
  return (
    <section className="editor cosign-box" aria-labelledby="h-cosign-form">
      <h2 id="h-cosign-form"><PenLine size={18} aria-hidden="true" /> Countersign as {role.role}</h2>
      <p className="quiet section-gap">You are asked to countersign version {version}, which the client approved. Times show in {timeZone}.</p>
      {identity && <OtpGate token={token} endpoint={`/api/cosign/${token}/otp`} to={identity.to} channel={identity.channel} session={session} onVerified={s => setSession(s)} purpose="your countersignature" />}
      <label>Your name<input maxLength={120} value={name} onChange={e => setName(e.target.value)} /></label>
      <label className="consent"><Checkbox checked={checked} onCheckedChange={v => setChecked(v === true)} />I have reviewed version {version} and countersign it as {role.role}.</label>
      {error && <p className="error" role="alert">{error}</p>}
      <div className="actions"><button className="primary" disabled={busy || (!!identity && !session)} onClick={sign}>{busy ? 'Signing…' : 'Countersign'}</button></div>
    </section>
  );
}
