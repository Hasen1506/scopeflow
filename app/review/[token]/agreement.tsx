'use client';
import {useEffect, useState} from 'react';
import {ShieldAlert, ShieldCheck} from 'lucide-react';
import {coSha256, coSummary, computeAgreement, describeEntry, paymentsOf, type Agreement, type CoView, type LedgerEntry} from '@/lib/ledger';
import {checkClientRecord, type RecordCheck, type SealState} from '@/lib/record-check';
import {formatMoney, type Version} from '@/lib/scope';
import {fromMinor} from '@/lib/minor';
import type {InvoiceView} from '@/lib/invoice-server';
import {formatInZone, formatDay} from '@/lib/time';
import {tEn, type Lang, type Translate} from '@/lib/i18n';
import {Checkbox} from '@/components/ui/checkbox';
import {api, post} from '@/app/ui';
import RetainerCounter from '@/app/components/slots/retainer-counter';
import type {RetainerView} from '@/lib/retainer'; // integration: WS-05's real RetainerCounter props replace the placeholder's Record<string, unknown>
import {OtpGate} from './otp-gate';
import {SlotOr} from './slot';
import {agreementNow, coImpact, type AgreementNow, type CoImpact} from './money-view';
import styles from './client.module.css';

export type ClientLedger = {entries: LedgerEntry[]; agreement: Agreement; anchors: Record<number, string>; head: string; seal?: {state: SealState}; invoices?: InvoiceView[]; online_payments?: boolean; retainer?: RetainerView | null}; // integration: was `unknown` against the Phase 0 placeholder
/** WS-05 may attach a preformatted one-line summary to a change order; shown when present. */
type CoShown = CoView & {display?: string};
type Check = {state: 'checking'} | RecordCheck;

/** Recomputes the record's fingerprints locally (lib/record-check.ts), so the client does not have to trust our server's word. */
function useVerification(scope: Version, ledger: ClientLedger, t: Translate): Check {
  const [check, setCheck] = useState<Check>({state: 'checking'});
  useEffect(() => {
    let live = true;
    checkClientRecord(scope, ledger).then(c => { if (live) setCheck(c); }, () => { if (live) setCheck({state: 'failed', detail: t('check.browserFail')}); });
    return () => { live = false; };
  }, [scope, ledger, t]);
  return check;
}

const fmt = (minor: number, currency: string) => formatMoney(fromMinor(minor, currency), currency);

/** LT-01: the agreement as it stands, from agreementTotals() (WS-01): fee after approved change orders, each tax head, total, paid, balance. */
export function AgreementNowCard({now, t}: {now: AgreementNow; t: Translate}) {
  const cur = now.currency;
  return (
    <section className={styles.now} aria-labelledby="agreement-now-title" data-testid="agreement-now">
      <h3 id="agreement-now-title">{t('now.title')}</h3>
      <p className="fine">{t('now.sub')}</p>
      <dl>
        <dt>{now.approved_cos === 0 ? t('now.fee') : now.approved_cos === 1 ? t('now.feeCo') : t('now.feeCos', {count: now.approved_cos})}</dt><dd data-row="fee">{fmt(now.fee, cur)}</dd>
        {now.heads.map((h, i) => <FragmentRow key={h.label + i} label={t('now.tax', {label: h.label, rate: h.rate})} value={fmt(h.amount, cur)} row={'tax-' + h.label.toLowerCase()} />)}
        <dt className={styles.total}>{now.heads.length ? t('now.total') : t('now.totalNoTax')}</dt><dd className={styles.total} data-row="total">{fmt(now.total, cur)}</dd>
        <dt>{t('now.paid')}</dt><dd data-row="paid">{fmt(now.paid, cur)}</dd>
        <dt className={styles.balance}>{t('now.balance')}</dt><dd className={styles.balance} data-row="balance">{now.balance > 0 ? fmt(now.balance, cur) : t('now.paidInFull')}</dd>
      </dl>
    </section>
  );
}
function FragmentRow({label, value, row}: {label: string; value: string; row: string}) {
  return <><dt>{label}</dt><dd data-row={row}>{value}</dd></>;
}

/** SF-23 / M7: what a change order costs incl. tax and what it does to the agreement total. */
function ImpactLines({impact, t}: {impact: CoImpact; t: Translate}) {
  const cur = impact.currency, sign = (n: number) => (n < 0 ? '−' : '+') + fmt(Math.abs(n), cur);
  return (
    <div className={styles.impact} data-testid="co-impact">
      <span><strong>{t('co.price')}: </strong>{impact.tax !== 0 ? t('co.priceLine', {fee: sign(impact.fee), label: impact.tax_label, tax: fmt(Math.abs(impact.tax), cur), total: (impact.total < 0 ? '−' : '') + fmt(Math.abs(impact.total), cur)}) : t('co.priceNoTax', {fee: sign(impact.fee)})}</span>
      <span>{t('co.totalLine', {before: fmt(impact.total_before, cur), after: fmt(impact.total_after, cur)})}</span>
    </div>
  );
}

type Identity = {method: string; to: string | null; channel?: 'email' | 'sms' | 'whatsapp'} | null;
export function AgreementView({token, scope, ledger, timeZone = 'UTC', onChanged, identity = null, otpSession = '', onOtpVerified, t = tEn, lang: _lang = 'en', readonly = false}: {token: string; scope: Version; ledger: ClientLedger; timeZone?: string; onChanged: () => Promise<void>; identity?: Identity; otpSession?: string; onOtpVerified?: (session: string) => void; t?: Translate; lang?: Lang; readonly?: boolean}) {
  const visible = ledger.entries.filter(e => e.baseline_version === scope.version);
  const a = computeAgreement(scope.content, scope.version, visible), cur = a.currency;
  const check = useVerification(scope, ledger, t);
  const pending = a.change_orders.filter(c => c.status === 'proposed');
  const decided = a.change_orders.filter(c => c.status !== 'proposed');
  const allItems = [...a.items, ...a.removed];
  const {paid} = paymentsOf(visible);
  const now = agreementNow(scope.content, visible, paid, a.change_orders.filter(c => c.status === 'approved').length);
  return (
    <section className="editor agreement-view" data-gap="top">
      <p className="eyebrow">{t('agreement.eyebrow')}</p>
      <div className="small-title"><h2>{t('agreement.title')}</h2>
        {check.state === 'ok' && check.signed && <span className="chain ok" title={check.head}><ShieldCheck size={14} />{t('chip.sealed')}</span>}
        {/* §6.1 wording: the record is unchanged but carries no Scopeflow seals (saved before sealing was on). */}
        {check.state === 'ok' && !check.signed && <span className="chain unsigned" title={check.head}><ShieldAlert size={14} />{t('chip.unsealed')}</span>}
        {check.state === 'failed' && <span className="chain bad"><ShieldAlert size={14} />{t('chip.failed')}</span>}
      </div>
      {/* UX-C66: the chips explain themselves here (the same glossary text as the decision card's). */}
      {(check.state === 'ok' || check.state === 'failed') && <details className="chip-help"><summary>{t('glossary.title')}</summary><ul><li>{t('glossary.recordCheck')}</li><li>{t('glossary.seal')}</li></ul></details>}
      <p className="quiet section-gap">{t('agreement.intro', {version: scope.version})}</p>
      <AgreementNowCard now={now} t={t} />
      <div className="agreement-grid">
        <div><span>{t('agreement.fee')}</span><strong>{formatMoney(a.fee, cur)}</strong>{a.fee !== a.fee_base && <em>{t('agreement.approvedAt', {amount: formatMoney(a.fee_base, cur)})}</em>}</div>
        <div><span>{t('agreement.delivery')}</span><strong>{formatDay(a.due) || t('agreement.notSet')}</strong>{a.days_shift !== 0 && <em>{t('agreement.days', {days: (a.days_shift > 0 ? '+' : '') + a.days_shift})}</em>}</div>
        <div><span>{t('agreement.rounds')}</span><strong className={a.rounds_over ? 'over' : ''}>{t('agreement.roundsUsed', {used: a.revisions_used, allowed: a.revisions_allowed})}</strong></div>
        {a.bank && <div><span>{t(a.bank.unit === 'hours' ? 'agreement.revHours' : 'agreement.revBudget')}</span><strong className={a.bank.over ? 'over' : ''}>{a.bank.unit === 'hours' ? t('agreement.hoursUsed', {used: a.bank.used, allowed: a.bank.allowed}) : t('agreement.budgetUsed', {used: formatMoney(a.bank.used, a.currency), allowed: formatMoney(a.bank.allowed, a.currency)})}</strong></div>}
        <div><span>{t('agreement.goodwill')}</span><strong>{formatMoney(a.goodwill_value, cur)}</strong></div>
      </div>
      {ledger.retainer !== undefined && ledger.retainer !== null && <SlotOr name="retainer-counter"><RetainerCounter retainer={ledger.retainer} /></SlotOr>}
      {!readonly && pending.length > 0 && identity && onOtpVerified && <OtpGate token={token} to={identity.to} channel={identity.channel} session={otpSession} onVerified={onOtpVerified} purpose={t(pending.length > 1 ? 'co.otpMany' : 'co.otpOne')} />}
      {/* integration: WS-05 ships CoCard, but its English-only card lacks this page's translated copy, the
          M7 impact lines (co-impact) and the #co-N.change-order anchors; mounted through SlotOr it also
          replaced the fallback a tick after first paint, detaching the form under the reader. The client
          page keeps its own translated card and sends WS-05's H17 proof (acknowledged + co_sha256). */}
      {pending.map(co => <PendingChangeOrder key={co.seq} token={token} co={co} agreement={a} scope={scope.content} impact={coImpact(scope.content, visible, co)} verified={check.state === 'ok'} onChanged={onChanged} otpSession={identity ? otpSession : ''} needsOtp={!!identity} t={t} readonly={readonly} />)}
      {decided.length > 0 && <>
        <h3 className="section-gap">{t('co.history')}</h3>
        <ul className={styles.coList}>
          {decided.map(co => {
            const impact = coImpact(scope.content, visible, co);
            return (
              <li key={co.seq} className={styles.coItem} id={'co-' + co.seq} data-testid={'co-decided-' + co.seq}>
                <DecidedChangeOrder co={co} impact={impact} t={t} />{/* integration: see the pending cards above */}
              </li>
            );
          })}
        </ul>
      </>}
      <h3 className="section-gap">{t('agreement.deliverablesNow')}</h3>
      <ul className="diff-list">
        {a.items.map(i => <li key={i.id}>{i.source !== 'baseline' ? <span className="diff-badge diff-add">CO-{i.source}</span> : <span className="diff-badge diff-change">{t('agreement.base')}</span>}<span>{i.title}{(i.qty > 1 || i.unit) && <span className="item-qty">× {i.qty}{i.unit ? ' ' + i.unit : ''}</span>}</span></li>)}
        {a.removed.map(i => <li key={'x' + i.id}><span className="diff-badge diff-remove">{t('diff.removed')}</span><s>{i.title}</s></li>)}
      </ul>
      {visible.length > 0 && (
        <>
          <h3 className="section-gap">{t('agreement.record')}</h3>
          <ol className="timeline">
            {[...visible].reverse().map(e => <li key={e.seq} className={'kind-' + e.kind}>{describeEntry(e, cur, allItems, scope.content.client_inputs ?? [])}<span className="fine">{t('agreement.entry', {seq: e.seq, date: formatInZone(e.created, timeZone)})}</span></li>)}
          </ol>
        </>
      )}
      <p className="fine">
        {check.state === 'ok' && <>{t(check.count === 1 ? 'check.okOne' : 'check.ok', {code: check.head.slice(0, 16), count: check.count})} {t(check.signed ? 'check.sealed' : 'check.unsealed')} {t('check.keep')}</>}
        {check.state === 'failed' && <>{check.detail} {t('check.failedAsk')}</>}
        {check.state === 'checking' && t('check.checking')}
      </p>
    </section>
  );
}

function DecidedChangeOrder({co, impact, t}: {co: CoView; impact: CoImpact; t: Translate}) {
  return (
    <>
      <span><strong>CO-{co.seq} · {co.title}</strong><br /><em>{co.settled_by ? t('co.decidedBy', {status: t('status.' + co.status), signer: co.settled_by}) : t('status.' + co.status)}</em>{(co as CoShown).display && <><br /><span className="fine" data-testid="co-display">{(co as CoShown).display}</span></>}</span>
      <span className={co.status === 'approved' ? styles.chipOk : co.status === 'declined' ? styles.chipBad : ''}>{t('status.' + co.status)}{co.status === 'approved' && impact.total !== 0 ? ` · ${(impact.total < 0 ? '−' : '+') + fmt(Math.abs(impact.total), impact.currency)}` : ''}</span>
    </>
  );
}

function PendingChangeOrder({token, co, agreement, scope, impact, verified, onChanged, otpSession, needsOtp, t, readonly}: {token: string; co: CoView; agreement: Agreement; scope: Version['content']; impact: CoImpact; verified: boolean; onChanged: () => Promise<void>; otpSession: string; needsOtp: boolean; t: Translate; readonly: boolean}) {
  const [name, setName] = useState('');
  const [comment, setComment] = useState('');
  const [checked, setChecked] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const cur = agreement.currency;
  async function decide(decision: 'approved' | 'declined') {
    setError('');
    if (!verified) return setError(t('co.errWait'));
    if (name.trim().length < 2) return setError(t('co.errName'));
    if (decision === 'approved' && !checked) return setError(t('co.errConsent'));
    if (decision === 'declined' && !comment.trim()) return setError(t('co.errWhy'));
    if (needsOtp && !otpSession) return setError(t('co.errCode'));
    setBusy(true);
    try {
      // integration: WS-05 H17 proof. The reviewer's tick is the acknowledgement; the hash is of the
      // change order exactly as this card shows it (lib/ledger.ts coCanonical). A decline without the
      // tick goes in the pre-WS-05 shape, which the route still accepts (not under SCOPEFLOW_CO_PROOF=strict).
      const proof = checked ? {acknowledged: true, co_sha256: await coSha256(co, scope)} : {};
      await api(`/api/review/${token}/change-order`, post({seq: co.seq, decision, signer: name, comment, ...proof, ...(otpSession ? {otp_session: otpSession} : {})})); await onChanged();
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  const effect = t('co.ifApproved', {before: formatMoney(agreement.fee, cur), after: formatMoney(agreement.fee + co.fee_delta, cur)})
    + (co.revisions_delta ? t('co.rounds', {before: agreement.revisions_allowed, after: agreement.revisions_allowed + co.revisions_delta}) : '')
    + (co.bank_delta && agreement.bank ? t(agreement.bank.unit === 'hours' ? 'co.bankHours' : 'co.bankBudget', {before: agreement.bank.allowed, after: agreement.bank.allowed + co.bank_delta}) : '')
    + (co.days_delta ? t(co.days_delta > 0 ? 'co.later' : 'co.earlier', {days: Math.abs(co.days_delta)}) : '') + '.';
  return (
    <div className="change-order" id={'co-' + co.seq}>
      <p className="eyebrow">{readonly ? t('co.eyebrowDecided', {seq: co.seq, status: t('status.pending')}) : t('co.eyebrow', {seq: co.seq})}</p>
      <h3>{co.title}</h3>
      {(co as CoShown).display && <p className="fine" data-testid="co-display">{(co as CoShown).display}</p>}
      {co.request_quote && <blockquote>“{co.request_quote}”</blockquote>}
      {co.reason && <p className="quiet">{co.reason}</p>}
      <p className="section-gap"><strong>{coSummary(co, cur, agreement.items)}</strong></p>
      <ImpactLines impact={impact} t={t} />
      <p className="fine">{effect}</p>
      {!readonly && <div className="no-print"><label>{t('co.name')}<input maxLength={120} value={name} onChange={e => setName(e.target.value)} /></label>
      <label>{t('co.comment')} <span className="quiet">{t('co.commentHint')}</span><textarea rows={2} maxLength={3000} value={comment} onChange={e => setComment(e.target.value)} /></label>
      <label className="consent"><Checkbox checked={checked} onCheckedChange={v => setChecked(v === true)} />{t('co.consent', {seq: co.seq})}</label>
      {error && <p className="error" role="alert">{error}</p>}
      <div className="actions"><button className="primary" disabled={busy || !verified || (needsOtp && !otpSession)} onClick={() => decide('approved')}>{busy ? t('decide.saving') : t('co.approve')}</button><button className="secondary" disabled={busy || !verified || (needsOtp && !otpSession)} onClick={() => decide('declined')}>{t('co.decline')}</button></div></div>}
    </div>
  );
}
