'use client';
import {useState} from 'react';
import {PenLine, Plus, ShieldCheck, Timer, X} from 'lucide-react';
import {LINK_EXPIRY_CHOICES} from '@/lib/link';
import {formatInZone} from '@/lib/time';
import {api, post} from './ui';
import {SavedNote, useSavedFlash} from './saved-status';

export type OtpChannel = 'email' | 'sms' | 'whatsapp';
export type ProjectSettings = {
  require_otp: boolean; client_email: string; client_phone: string; otp_channel: OtpChannel;
  link_expiry_days: number | null; link_issued: string | null;
  cosigners: {id: string; role: string}[];
  retention_days?: number | null; legal_hold?: boolean; legal_hold_reason?: string; legal_hold_set?: string | null;
};
export type CosignView = {cosigner_id: string; role: string; signer: string; signed: string};

const CHANNEL_LABEL: Record<OtpChannel, string> = {email: 'Email', sms: 'SMS', whatsapp: 'WhatsApp'};
const slug = (role: string) => role.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 24) || 'role';

/**
 * Trust settings for one project, in the Approval step: an identity check before the client signs
 * (email, SMS or WhatsApp code), when the review link of an undecided version expires, and roles
 * that must countersign after approval.
 */
export function TrustSettings({projectId, settings, channels, pending, expires, cosigns, approved, timeZone, onChange}: {
  projectId: string; settings: ProjectSettings; channels: OtpChannel[]; pending: boolean; expires: string | null;
  cosigns: CosignView[]; approved: boolean; timeZone: string | null; onChange: (s: ProjectSettings) => void;
}) {
  const [now] = useState(() => Date.now()), [busy, setBusy] = useState(false), [error, setError] = useState(''), [phone, setPhone] = useState(settings.client_phone), [role, setRole] = useState('');
  const {saved, flash, clear} = useSavedFlash();
  async function patch(change: Partial<ProjectSettings>) {
    setBusy(true); setError(''); clear();
    try { const r = await api(`/api/scopes/${projectId}`, {...post(change), method: 'PATCH'}); onChange(r.project); flash(); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  const channel = settings.otp_channel, needsPhone = channel !== 'email';
  const destinationMissing = needsPhone ? !settings.client_phone : !settings.client_email;
  const canDeliver = channels.includes(channel);
  const signedBy = new Map(cosigns.map(c => [c.cosigner_id, c]));
  return (
    <div className="trust-settings section-gap">
      <h4 className="h-sub"><ShieldCheck size={15} aria-hidden="true" /> Identity and signing</h4>
      <label className="check-row">
        <input type="checkbox" checked={settings.require_otp} disabled={busy || (!settings.require_otp && (destinationMissing || !canDeliver))} onChange={e => patch({require_otp: e.target.checked})} />
        <span>Require a one-time code before the client decides
          <span className="fine block">{!canDeliver ? `Unavailable: ${CHANNEL_LABEL[channel]} delivery is not configured on this server.` : destinationMissing ? `Save the client ${needsPhone ? 'phone number' : 'email'} first: the code is sent there.` : 'The client confirms a 6-digit code before approving the scope or a change order; the check is recorded in the signed decision.'}</span>
        </span>
      </label>
      {channels.length > 1 || channel !== 'email' ? (
        <div className="two-col">
          <label>Send the code by
            <select value={channel} disabled={busy} onChange={e => patch({otp_channel: e.target.value as OtpChannel})}>
              {(['email', 'sms', 'whatsapp'] as const).filter(c => channels.includes(c) || c === channel).map(c => <option key={c} value={c}>{CHANNEL_LABEL[c]}{channels.includes(c) ? '' : ' (not configured)'}</option>)}
            </select>
          </label>
          {needsPhone && <label>Client phone <span className="quiet">· international form</span>
            <span className="inline-field"><input inputMode="tel" autoComplete="off" placeholder="+919876543210" value={phone} maxLength={16} onChange={e => setPhone(e.target.value.replace(/[^\d+]/g, ''))} />
              <button type="button" className="secondary" disabled={busy || phone === settings.client_phone} onClick={() => patch({client_phone: phone})}>Save</button></span>
          </label>}
        </div>
      ) : null}
      <label className="section-gap"><span><Timer size={14} aria-hidden="true" /> Review link expiry <span className="quiet">· only while the client has not decided</span></span>
        <select value={settings.link_expiry_days ?? ''} disabled={busy} onChange={e => patch({link_expiry_days: e.target.value ? Number(e.target.value) : null})}>
          <option value="">Never expires</option>
          {LINK_EXPIRY_CHOICES.map(d => <option key={d} value={d}>{d} days after it is shared</option>)}
        </select>
      </label>
      {pending && expires && <p className="fine" role="note">{Date.parse(expires) <= now ? <>This link expired on {formatInZone(expires, timeZone)}. Replace the review link to share a fresh one.</> : <>This link stops working on {formatInZone(expires, timeZone)} unless the client decides first. Replacing the link starts a new period.</>}</p>}
      <div className="section-gap">
        <span className="action-label"><PenLine size={14} aria-hidden="true" /> Countersignatures</span>
        <p className="fine">Roles that sign after the client approves, such as a finance approver. They sign on the same review link; the approval itself does not change.</p>
        {settings.cosigners.length > 0 && <ul className="cosign-list">
          {settings.cosigners.map(c => {
            const s = signedBy.get(c.id);
            return <li key={c.id}><strong>{c.role}</strong>{approved ? (s ? <span className="tag status-approved">Signed by {s.signer} · {formatInZone(s.signed, timeZone)}</span> : <span className="tag status-pending">Waiting</span>) : null}
              {!s && <button type="button" className="link-button" disabled={busy} aria-label={`Remove ${c.role}`} onClick={() => patch({cosigners: settings.cosigners.filter(x => x.id !== c.id)})}><X size={14} /></button>}</li>;
          })}
        </ul>}
        {settings.cosigners.length < 3 && <div className="inline-field">
          <input aria-label="Countersigning role" placeholder="e.g. Finance approver" maxLength={60} value={role} onChange={e => setRole(e.target.value)} />
          <button type="button" className="secondary" disabled={busy || role.trim().length < 2} onClick={() => { const base = slug(role); let id = base, n = 2; while (settings.cosigners.some(c => c.id === id)) id = `${base.slice(0, 21)}-${n++}`; void patch({cosigners: [...settings.cosigners, {id, role: role.trim()}]}).then(() => setRole('')); }}><Plus size={15} />Add role</button>
        </div>}
      </div>
      <SavedNote saved={saved} />
      {error && <p className="error" role="alert">{error}</p>}
    </div>
  );
}
