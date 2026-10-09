'use client';
import {useState} from 'react';
import {Archive, Lock} from 'lucide-react';
import {formatInZone} from '@/lib/time';
import {api, post} from './ui';

export type RetentionView = {retention_days: number | null; legal_hold: boolean; legal_hold_reason: string; legal_hold_set: string | null};

/** Per-project retention: its own period for client network details, and a legal hold that freezes the project. */
export function RetentionSettings({projectId, settings, timeZone, onChange}: {projectId: string; settings: RetentionView; timeZone: string | null; onChange: (s: RetentionView) => void}) {
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [reason, setReason] = useState(settings.legal_hold_reason);
  async function patch(change: Partial<RetentionView>) {
    setBusy(true); setError('');
    try { const r = await api(`/api/scopes/${projectId}`, {...post(change), method: 'PATCH'}); onChange(r.project); setReason(r.project.legal_hold_reason ?? ''); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  return (
    <div className="section-gap" role="group" aria-labelledby="h-retention-project">
      <h4 className="h-sub" id="h-retention-project"><Archive size={15} aria-hidden="true" /> Retention</h4>
      <label>Keep client network details on this project
        <select value={settings.retention_days ?? ''} disabled={busy || settings.legal_hold} onChange={e => void patch({retention_days: e.target.value === '' ? null : Number(e.target.value)})}>
          <option value="">Account setting (Data controls)</option>
          {[30, 90, 180, 365, 730, 1825].map(d => <option key={d} value={d}>{d} days</option>)}
        </select>
      </label>
      {settings.legal_hold
        ? <div className="muted-box" role="status"><strong><Lock size={14} aria-hidden="true" /> On legal hold</strong>{settings.legal_hold_set ? ` since ${formatInZone(settings.legal_hold_set, timeZone ?? 'UTC')}` : ''}<p className="fine">Nothing on this project is redacted or deleted, and the project (and your account) cannot be deleted, until you lift the hold.{settings.legal_hold_reason ? ` Note: ${settings.legal_hold_reason}` : ''}</p><button className="secondary" disabled={busy} onClick={() => void patch({legal_hold: false})}>Lift legal hold</button></div>
        : <details className="disclosure"><summary>Legal hold <span className="quiet">· for a dispute or a legal request</span></summary>
            <p className="fine">A hold keeps everything on this project exactly as it is: no retention redaction, no draft expiry and no deletion until you lift it.</p>
            <label>Reason <span className="quiet">· optional, only you see it</span><input maxLength={300} value={reason} onChange={e => setReason(e.target.value)} placeholder="e.g. Payment dispute raised on 2026-10-01" /></label>
            <div className="actions"><button className="secondary" disabled={busy} onClick={() => void patch({legal_hold: true, legal_hold_reason: reason})}>Place legal hold</button></div>
          </details>}
      {error && <p className="error" role="alert">{error}</p>}
    </div>
  );
}
