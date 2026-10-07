'use client';
import {useEffect, useState} from 'react';
import {ShieldAlert, ShieldCheck} from 'lucide-react';
import {coSummary, computeAgreement, describeEntry, type Agreement, type CoView, type LedgerEntry} from '@/lib/ledger';
import {checkClientRecord, type RecordCheck, type SealState} from '@/lib/record-check';
import {formatMoney, type Version} from '@/lib/scope';
import {formatInZone} from '@/lib/time';
import {Checkbox} from '@/components/ui/checkbox';
import {api, post} from '@/app/ui';

export type ClientLedger = {entries: LedgerEntry[]; agreement: Agreement; anchors: Record<number, string>; head: string; seal?: {state: SealState}};
type Check = {state: 'checking'} | RecordCheck;

/** Recomputes the record's fingerprints locally (lib/record-check.ts), so the client does not have to trust our server's word. */
function useVerification(scope: Version, ledger: ClientLedger): Check {
  const [check, setCheck] = useState<Check>({state: 'checking'});
  useEffect(() => {
    let live = true;
    checkClientRecord(scope, ledger).then(c => { if (live) setCheck(c); }, () => { if (live) setCheck({state: 'failed', detail: 'This browser could not run the check.'}); });
    return () => { live = false; };
  }, [scope, ledger]);
  return check;
}

export function AgreementView({token, scope, ledger, timeZone = 'UTC', onChanged}: {token: string; scope: Version; ledger: ClientLedger; timeZone?: string; onChanged: () => Promise<void>}) {
  const a = computeAgreement(scope.content,scope.version,ledger.entries.filter(e=>e.baseline_version===scope.version)), cur = a.currency;
  const check = useVerification(scope, ledger);
  const pending = a.change_orders.filter(c => c.status === 'proposed');
  const allItems = [...a.items, ...a.removed];
  const visible = ledger.entries.filter(e => e.baseline_version === scope.version);
  return (
    <section className="editor agreement-view" style={{marginTop: 24}}>
      <p className="eyebrow">AFTER APPROVAL</p>
      <div className="small-title"><h2>Current agreement</h2>
        {check.state === 'ok' && check.signed && <span className="chain ok" title={check.head}><ShieldCheck size={14} />Verified in your browser</span>}
        {/* Fingerprints match but the record carries no Scopeflow signatures (legacy records, or signatures removed): say so instead of claiming full verification. */}
        {check.state === 'ok' && !check.signed && <span className="chain unsigned" title={check.head}><ShieldAlert size={14} />Fingerprints match · not signed</span>}
        {check.state === 'failed' && <span className="chain bad"><ShieldAlert size={14} />Record check failed</span>}
      </div>
      <p className="quiet section-gap">Version {scope.version} is the approved baseline. Change orders need your approval before they apply. The creator also records revision rounds, received inputs, delivery shifts, and goodwill here.</p>
      <div className="agreement-grid">
        <div><span>Fee</span><strong>{formatMoney(a.fee, cur)}</strong>{a.fee !== a.fee_base && <em>approved at {formatMoney(a.fee_base, cur)}</em>}</div>
        <div><span>Delivery</span><strong>{a.due || 'Not set'}</strong>{a.days_shift !== 0 && <em>{a.days_shift > 0 ? '+' : ''}{a.days_shift} days</em>}</div>
        <div><span>Revision rounds</span><strong className={a.rounds_over ? 'over' : ''}>{a.revisions_used} of {a.revisions_allowed} used</strong></div>
        <div><span>Extra work not billed</span><strong>{formatMoney(a.goodwill_value, cur)}</strong></div>
      </div>
      {pending.map(co => <PendingChangeOrder key={co.seq} token={token} co={co} agreement={a} verified={check.state==='ok'} onChanged={onChanged} />)}
      <h3 className="section-gap">Deliverables now</h3>
      <ul className="diff-list">
        {a.items.map(i => <li key={i.id}>{i.source !== 'baseline' ? <span className="diff-badge diff-add">CO-{i.source}</span> : <span className="diff-badge diff-change">Base</span>}<span>{i.title}{(i.qty > 1 || i.unit) && <span className="item-qty">× {i.qty}{i.unit ? ' ' + i.unit : ''}</span>}</span></li>)}
        {a.removed.map(i => <li key={'x' + i.id}><span className="diff-badge diff-remove">Removed</span><s>{i.title}</s></li>)}
      </ul>
      {visible.length > 0 && (
        <>
          <h3 className="section-gap">Record</h3>
          <ol className="timeline">
            {[...visible].reverse().map(e => <li key={e.seq} className={'kind-' + e.kind}>#{e.seq} · {describeEntry(e, cur, allItems, scope.content.client_inputs ?? [])}<span className="fine">{formatInZone(e.created, timeZone)}</span></li>)}
          </ol>
        </>
      )}
      <p className="fine">
        {check.state === 'ok' && <>Record fingerprint <span className="mono">{check.head.slice(0, 16)}</span> covers {check.count} entries. Every entry is linked to the one before it and to the approved scope, so a later edit to any of them would change this fingerprint. {check.signed ? ' Every entry and the approval carry Scopeflow signatures that were verified.' : ' Some entries were recorded before signatures were introduced.'} Save or print this page to keep a copy.</>}
        {check.state === 'failed' && <>{check.detail} Ask the creator about it before approving anything further.</>}
        {check.state === 'checking' && 'Checking the record…'}
      </p>
    </section>
  );
}

function PendingChangeOrder({token, co, agreement, verified, onChanged}: {token: string; co: CoView; agreement: Agreement; verified:boolean; onChanged: () => Promise<void>}) {
  const [name, setName] = useState('');
  const [comment, setComment] = useState('');
  const [checked, setChecked] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const cur = agreement.currency;
  async function decide(decision: 'approved' | 'declined') {
    setError('');
    if(!verified)return setError('Wait for the record check to pass before recording a decision.');
    if (name.trim().length < 2) return setError('Enter your name to record this decision.');
    if (decision === 'approved' && !checked) return setError('Confirm that you reviewed this change before approving.');
    if (decision === 'declined' && !comment.trim()) return setError('Please say why, so the creator can follow up.');
    setBusy(true);
    try { await api(`/api/review/${token}/change-order`, post({seq: co.seq, decision, signer: name, comment})); await onChanged(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  return (
    <div className="change-order" id={'co-' + co.seq}>
      <p className="eyebrow">CHANGE ORDER CO-{co.seq} · AWAITING YOU</p>
      <h3>{co.title}</h3>
      {co.request_quote && <blockquote>“{co.request_quote}”</blockquote>}
      {co.reason && <p className="quiet">{co.reason}</p>}
      <p className="section-gap"><strong>{coSummary(co, cur, agreement.items)}</strong></p>
      <p className="fine">If approved: fee {formatMoney(agreement.fee, cur)} → {formatMoney(agreement.fee + co.fee_delta, cur)}{co.revisions_delta ? `, revision rounds ${agreement.revisions_allowed} → ${agreement.revisions_allowed + co.revisions_delta}` : ''}{co.days_delta ? `, delivery moves ${co.days_delta > 0 ? 'later' : 'earlier'} by ${Math.abs(co.days_delta)} days` : ''}.</p>
      <div className="no-print"><label>Your name<input maxLength={120} value={name} onChange={e => setName(e.target.value)} /></label>
      <label>Comment <span className="quiet">· required if declining</span><textarea rows={2} maxLength={3000} value={comment} onChange={e => setComment(e.target.value)} /></label>
      <label style={{display: 'flex', gap: 12, alignItems: 'start'}}><Checkbox checked={checked} onCheckedChange={v => setChecked(v === true)} style={{marginTop: 4}} />I have reviewed CO-{co.seq}, including its effect on the fee and timeline.</label>
      {error && <p className="error" role="alert">{error}</p>}
      <div className="actions"><button className="primary" disabled={busy||!verified} onClick={() => decide('approved')}>{busy ? 'Saving…' : 'Approve change'}</button><button className="secondary" disabled={busy||!verified} onClick={() => decide('declined')}>Decline</button></div></div>
    </div>
  );
}
