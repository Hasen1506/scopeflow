'use client';
import Link from 'next/link';
import {useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore} from 'react';
import {brandNameInk, readableOn, serverThemeSnapshot, subscribeTheme, themeSnapshot} from '@/lib/theme';
import {sha256, paymentsOf, computeAgreement} from '@/lib/ledger';
import {Scope, Version, formatMoney} from '@/lib/scope';
import {api, post, Skeleton, type ApiError} from '@/app/ui';
import {Checkbox} from '@/components/ui/checkbox';
import {ScopeDiff} from '@/app/scope-diff';
import {formatDay, formatInZone} from '@/lib/time';
import {afterConsent} from '@/lib/a11y';
import {LANG_STORAGE_KEY, isLang, pickLang, translator, type Lang} from '@/lib/i18n';
import PayBlock from '@/app/components/slots/pay-block';
import DataNotice from '@/app/components/slots/data-notice';
import {AgreementView, type ClientLedger} from './agreement';
import {OtpGate} from './otp-gate';
import {Countersign, type CosignState} from './countersign';
import {ClientHeader} from './client-header';
import {ScopeDocument} from './scope-document';
import {ClosedBanner, NewerBanner, readonlyOf, type ReadonlyInfo} from './closed';
import {LinkProblem, problemOf, type LinkProblemState} from './link-problem';
import {SlotOr} from './slot';
import {DECISION_COOLDOWN_S, decisionUnavailable, tellSenderHref} from './states';
import {EvidenceBlock, type RecordEvidence} from './evidence';
import styles from './client.module.css';

/** WS-04 may attach TDS figures to an invoice; the net is shown when present. */
type InvoiceShown = NonNullable<ClientLedger['invoices']>[number] & {tds?: {net_receivable?: number}};
type Brand = {name: string; color: string | null; text_color: string | null; logo_url: string | null};
type Deposit = {pct: number; amount: number; currency: string; paid: null | {amount: number; currency: string; payment_id: string | null; paid_at: string | null; paid_on?: string | null}; enabled: boolean; provider: string | null; reason: string | null};
type Identity = {method: string; to: string | null; channel?: 'email' | 'sms' | 'whatsapp'};
type ReviewData = {
  scope: Version & {latest: number}; previous: Scope | null; ledger?: ClientLedger | null; deposit?: Deposit | null; time_zone?: string;
  identity_check?: Identity | null; cosign?: CosignState | null; link_expires?: string | null; brand?: Brand | null;
  /** M32 (WS-08): days after which the reviewer's IP address and browser are redacted. */
  retention_days?: number | null;
  /** L12 (WS-02): where the newer version can be opened, when the API shares it. */
  newer_url?: string | null;
  /** L12 (WS-02): the newer version's number, when the GET shares it. */
  newer_version?: number | null;
  /** WS-02: server-written expiry wording; preferred over formatting `link_expires` here. */
  link_expires_text?: string | null;
  /** WS-02: how the decision was evidenced. */
  evidence?: RecordEvidence | null;
  /** WS-08: a server-written data notice line, when present. */
  data_notice?: string | null;
};
type Notice = {retention_days?: number | null; data_notice?: string | null};
/** Where the reviewer's unsent name and comment are kept on this device (L12): never the full link token. */
const draftKey = (token: string) => 'scopeflow:review-draft:' + token.slice(0, 16);

/** Loads Razorpay Checkout once, on demand (CSP allows only checkout.razorpay.com). */
const CHECKOUT_SRC = 'https://checkout.razorpay.com/v1/checkout.js';
let checkoutLoading: Promise<void> | null = null;
/** U3: one script tag per page: a retry reuses the pending load (or the tag already on the page) instead of adding another. */
function loadCheckout() {
  if ((window as unknown as {Razorpay?: unknown}).Razorpay) return Promise.resolve();
  if (checkoutLoading) return checkoutLoading;
  checkoutLoading = new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${CHECKOUT_SRC}"]`);
    const s = existing ?? document.createElement('script');
    const fail = () => { checkoutLoading = null; s.remove(); reject(new Error('Razorpay Checkout could not be loaded.')); };
    s.addEventListener('load', () => resolve(), {once: true});
    s.addEventListener('error', fail, {once: true});
    if (!existing) { s.src = CHECKOUT_SRC; s.async = true; document.head.appendChild(s); }
  });
  return checkoutLoading;
}
type RazorpayInstance = {open: () => void; on: (event: string, cb: (r: {error?: {description?: string}}) => void) => void};

export default function Review({token, queryLang = null, acceptLang = null}: {token: string; queryLang?: Lang | null; acceptLang?: Lang | null}) {
  const [data, setData] = useState<ReviewData | null>(null), [problem, setProblem] = useState<LinkProblemState | null>(null);
  const [busy, setBusy] = useState(false), [name, setName] = useState(''), [comment, setComment] = useState(''), [checked, setChecked] = useState(false);
  const [receipt, setReceipt] = useState<Record<string, unknown> | null>(null), [otpSession, setOtpSession] = useState('');
  const [depositNote, setDepositNote] = useState(''), [paying, setPaying] = useState(false), [returned, setReturned] = useState<'ok' | 'cancel' | null>(null);
  const [invoiceNote, setInvoiceNote] = useState(''), [payingInvoice, setPayingInvoice] = useState<number | null>(null);
  // A6: both decision buttons share one busy pattern; `deciding` says which one shows "Saving…".
  const [deciding, setDeciding] = useState<string | null>(null);
  const [decideError, setDecideError] = useState(''), [newer, setNewer] = useState<{version: number; url: string | null} | null>(null), [justApproved, setJustApproved] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null), noticeAsked = useRef(false);
  const outcome = useRef<HTMLHeadingElement>(null), focusOutcome = useRef(false);

  // SF-09: ?lang= > the reader's own choice on this device > the creator's scope language > Accept-Language > English.
  const [payFilled, setPayFilled] = useState(false);
  // #59/B-1: after the server could not record a decision, both buttons rest for a short cooldown and the
  // reader gets a clear message plus a way to tell the sender. Server behaviour is unchanged.
  const [unavailable, setUnavailable] = useState(false), [cooldown, setCooldown] = useState(0);
  useEffect(() => { if (cooldown <= 0) return; const id = setTimeout(() => setCooldown(c => c - 1), 1000); return () => clearTimeout(id); }, [cooldown]);
  const resting = cooldown > 0;
  const [chosen, setChosen] = useState<Lang | null>(queryLang);
  useEffect(() => { if (queryLang) return; try { const s = localStorage.getItem(LANG_STORAGE_KEY); if (isLang(s)) queueMicrotask(() => setChosen(s)); } catch { /* storage blocked */ } }, [queryLang]);
  const lang = pickLang({query: chosen, scope: data?.scope.content.language, accept: acceptLang ?? undefined});
  const t = useMemo(() => translator(lang), [lang]);
  function chooseLang(next: Lang) {
    setChosen(next);
    try { localStorage.setItem(LANG_STORAGE_KEY, next); } catch { /* storage blocked */ }
    const url = new URL(location.href); url.searchParams.set('lang', next); history.replaceState(null, '', url.pathname + url.search);
  }

  const apply = useCallback((d: ReviewData) => { setData(d); setProblem(null); }, []);
  const load = useCallback(async () => { apply(await api('/api/review/' + token)); }, [token, apply]);
  useEffect(() => { let live = true; api('/api/review/' + token).then(d => { if (live) apply(d); }, e => { if (live) setProblem(problemOf(e)); }); return () => { live = false; }; }, [token, apply]);
  // M32: the review payload may lack retention; ask the account notice once, and ignore a 404 (or any failure).
  useEffect(() => {
    if (!data || noticeAsked.current || typeof data.retention_days === 'number') return;
    noticeAsked.current = true;
    api('/api/account/notice/' + token).then((n: Notice) => { if (n && typeof n === 'object') setNotice(n); }, () => { /* no notice: the honest default line */ });
  }, [data, token]);
  useEffect(() => { if (focusOutcome.current && data && data.scope.status !== 'pending') { focusOutcome.current = false; outcome.current?.focus(); } }, [data]);

  // L12: the typed name and comment survive a reload, a 409 and a replaced version, on this device only.
  useEffect(() => { try { const saved = JSON.parse(localStorage.getItem(draftKey(token)) || 'null') as {name?: string; comment?: string} | null; if (saved) queueMicrotask(() => { if (typeof saved.name === 'string') setName(saved.name); if (typeof saved.comment === 'string') setComment(saved.comment); }); } catch { /* storage blocked or malformed */ } }, [token]);
  useEffect(() => { try { if (name || comment) localStorage.setItem(draftKey(token), JSON.stringify({name, comment})); else localStorage.removeItem(draftKey(token)); /* U5: a cleared draft stays cleared after a reload */ } catch { /* storage blocked */ } }, [token, name, comment]);
  // L12: when the reader comes back to the tab, re-check whether a newer version was shared meanwhile.
  useEffect(() => {
    let last = Date.now();
    const onVisible = () => { if (document.visibilityState !== 'visible' || Date.now() - last < 60_000) return; last = Date.now(); api('/api/review/' + token).then(apply, () => { /* keep what is shown */ }); };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [token, apply]);

  const scope = data?.scope ?? null, ledger = data?.ledger ?? null, deposit = data?.deposit ?? null, timeZone = data?.time_zone ?? 'UTC';
  const identity = data?.identity_check ?? null, cosign = data?.cosign ?? null, linkExpires = data?.link_expires ?? null, brand = data?.brand ?? null;
  const ro: ReadonlyInfo = readonlyOf(data);
  // UX-C05: the owner's colour is drawn on this page's own background, which follows the visitor's light or dark
  // scheme. Text gets a shade that reaches 4.5:1 there and the accent rule one that reaches 3:1 (same hue).
  const themeKey = useSyncExternalStore(subscribeTheme, themeSnapshot, serverThemeSnapshot);
  const brandInk = useMemo(() => {
    const color = brand?.color ?? null, textColor = brand?.text_color ?? null;
    // N5: until the background is known (server render) no owner colour is applied unchecked; the name uses --ink.
    if ((!color && !textColor) || typeof document === 'undefined') return {text: null, rule: color};
    const bg = themeKey && getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
    return {text: brandNameInk(textColor, color, bg), rule: color ? readableOn(color, bg, 3) ?? color : null};
  }, [brand?.color, brand?.text_color, themeKey]);
  const replaced = !!scope && scope.version < scope.latest;
  const servedNewer = Number(data?.newer_version), newerVersion = newer?.version ?? (Number.isInteger(servedNewer) && servedNewer > (scope?.version ?? 0) ? servedNewer : null) ?? (replaced ? scope!.latest : null);
  const evidence = data?.evidence ?? null, linkExpiresText = data?.link_expires_text ?? null;

  async function decide(decision: string) {
    if (cooldown > 0) return;
    setDecideError(''); setUnavailable(false);
    if (ro.readonly) { setDecideError(t('closed.noActions')); return; }
    if (name.trim().length < 2) { setDecideError(t('decide.errName')); document.getElementById('signer-name')?.focus(); return; }
    if (!checked) { setDecideError(t('decide.errConsent')); document.getElementById('decide-consent')?.focus(); return; }
    if (decision === 'changes_requested' && !comment.trim()) { setDecideError(t('decide.errComment')); document.getElementById('decision-comment')?.focus(); return; }
    if (identity && !otpSession) { setDecideError(t(identity.channel && identity.channel !== 'email' ? 'decide.errCodePhone' : 'decide.errCodeEmail')); return; }
    setBusy(true); setDeciding(decision);
    try {
      // SF-15: the server checks the acknowledgement and that this is exactly the content shown.
      const content_sha256 = await sha256(JSON.stringify(scope!.content));
      const r = await api('/api/review/' + token, post({decision, signer: name, comment, version: scope!.version, acknowledged: true, content_sha256, ...(otpSession ? {otp_session: otpSession} : {})}));
      setReceipt(r.receipt ?? null); setJustApproved(decision === 'approved'); focusOutcome.current = true;
      try { localStorage.removeItem(draftKey(token)); } catch { /* storage blocked */ }
      await load();
    } catch (e) {
      const err = e as ApiError;
      // L12: a newer version replaced this one while the reader was deciding; keep what they typed.
      const v = Number(err.data?.newer_version);
      if (err.status === 409 && Number.isInteger(v) && v > 0) setNewer({version: v, url: typeof err.data?.newer_url === 'string' ? err.data.newer_url : null});
      if (decisionUnavailable(err) && !(err.status === 409)) { setUnavailable(true); setCooldown(DECISION_COOLDOWN_S); setDecideError(t('decide.unavailable')); }
      else setDecideError(err.message);
      if (err.status === 409) load().catch(() => { /* the banner and the kept comment are enough */ });
    } finally { setBusy(false); }
  }
  /** Starts an online payment (the deposit, or an open invoice): Razorpay's widget, or a redirect to Stripe Checkout. */
  // U3: the reload timer after a Razorpay payment is cleared on unmount and replaced (not stacked) by the next payment.
  const reloadTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (reloadTimer.current) clearTimeout(reloadTimer.current); }, []);
  /** Resolves once the Razorpay widget settles (paid, failed or dismissed), so the button stays busy until then. */
  async function pay(path: string, label: string, done: (note: string) => void) {
    const o = await api(path, post({}));
    if (o.provider === 'stripe') { try { sessionStorage.setItem('scopeflow:payment-return', token); } catch { /* the return page then explains how to come back */ } location.assign(o.url); return; }
    await loadCheckout();
    const Razorpay = (window as unknown as {Razorpay: new (options: Record<string, unknown>) => RazorpayInstance}).Razorpay;
    await new Promise<void>(resolve => {
      let settled = false;
      const finish = (note: string) => { if (settled) return; settled = true; done(note); resolve(); };
      const rzp = new Razorpay({key: o.key_id, order_id: o.order_id, amount: o.amount_minor, currency: o.currency, name: o.name, description: o.description,
        handler: () => { finish(t('deposit.submitted', {label})); if (reloadTimer.current) clearTimeout(reloadTimer.current); reloadTimer.current = setTimeout(() => { reloadTimer.current = null; void load(); }, 4000); },
        // U3: closing the widget without paying says so instead of leaving the page silent.
        modal: {ondismiss: () => finish(t('deposit.returnCancel'))}});
      // U3: a declined or failed payment shows the provider's reason (the widget stays open so the client can retry there).
      rzp.on('payment.failed', r => { done(r?.error?.description || t('deposit.returnCancel')); });
      rzp.open();
    });
  }
  async function payDeposit() { setDepositNote(''); setPaying(true); try { await pay(`/api/review/${token}/deposit`, t('deposit.title'), setDepositNote); } catch (e) { setDepositNote((e as Error).message); } finally { setPaying(false); } }
  async function payInvoice(seq: number, number: string) { setInvoiceNote(''); setPayingInvoice(seq); try { await pay(`/api/review/${token}/invoices/${seq}/pay`, number, setInvoiceNote); } catch (e) { setInvoiceNote((e as Error).message); } finally { setPayingInvoice(null); } }
  // Back from Stripe Checkout: say what happened while the webhook catches up.
  useEffect(() => { const p = new URLSearchParams(location.search).get('payment'); if (!p) return; queueMicrotask(() => setReturned(p === 'success' ? 'ok' : 'cancel')); const url = new URL(location.href); url.searchParams.delete('payment'); history.replaceState(null, '', url.pathname + url.search); const tm = setTimeout(() => { void load(); }, 5000); return () => clearTimeout(tm); }, [load]);

  // Payments the creator recorded (bank transfer, UPI…) count toward the deposit too, not only Razorpay.
  const recordedPaid = ledger && scope ? paymentsOf(ledger.entries.filter(e => e.baseline_version === scope.version)).paid : 0;
  const depositDue = !!deposit && !deposit.paid && recordedPaid < deposit.amount;
  const openInvoice = ledger?.invoices?.find(i => i.open > 0) ?? null;
  const changedByCos = !!ledger && !!scope && computeAgreement(scope.content, scope.version, ledger.entries.filter(e => e.baseline_version === scope.version)).change_orders.some(c => c.status === 'approved');

  return <>
    <ClientHeader lang={lang} onLang={chooseLang} />
    <main id="content" tabIndex={-1} lang={lang} data-client-page="" className={'review-shell ' + styles.shell} aria-busy={!scope && !problem} style={brandInk.rule ? {['--brand-accent' as string]: brandInk.rule} : undefined}>
      {/* eslint-disable-next-line @next/next/no-img-element -- the owner logo is small, fixed-height and content-addressed; next/image adds nothing */}
      {brand && (brand.logo_url || brand.name) && <div className={'client-brand no-print' + (brand.color ? ' has-accent' : '')}>{brand.logo_url ? <img src={brand.logo_url} alt={brand.name || 'Logo'} height={40} /> : <strong style={brandInk.text ? {color: brandInk.text} : undefined}>{brand.name}</strong>}{brand.logo_url && brand.name && <span className="quiet">{brand.name}</span>}</div>}
      {!scope && !problem && <div className="paper"><Skeleton lines={7} label={t('page.loading')} /></div>}
      {problem && <LinkProblem problem={problem} t={t} timeZone={timeZone} onRetry={() => { setProblem(null); load().catch(e => setProblem(problemOf(e))); }} />}
      {scope && !problem && <>
        <ClosedBanner info={ro} t={t} timeZone={timeZone} />
        {newerVersion && scope.status === 'pending' && <NewerBanner version={newerVersion} url={newer?.url ?? data?.newer_url ?? null} t={t} hasDraft={!!comment.trim()} />}
        <p className="eyebrow no-print">{changedByCos ? t('page.eyebrowFirst', {version: scope.version}) : t('page.eyebrow', {version: scope.version})}</p>
        {changedByCos && <p className="fine no-print">{t('page.firstApprovedNote')}</p>}
        <ScopeDocument scope={scope.content} version={scope.version} status={scope.status} t={t} firstApproved={changedByCos} />
        {data?.previous && <ScopeDiff previous={data.previous} current={scope.content} title={t('page.changesFrom', {version: scope.version - 1})} t={t} />}
        <section className="editor no-print">
          {replaced ? <>
            <h2 ref={outcome} tabIndex={-1}>{t('replaced.heading')}</h2>
            <p className="quiet section-gap">{t('replaced.body', {version: scope.version})}</p>
            {scope.signer && <p className="section-gap">{t('replaced.decided', {status: t('status.' + scope.status), signer: scope.signer, date: formatInZone(scope.decided, timeZone)})}</p>}
            {scope.status === 'pending' && comment.trim() && <label>{t('decide.comment')}<textarea id="decision-comment" rows={3} readOnly value={comment} /></label>}
          </> : scope.status !== 'pending' ? <>
            {scope.status === 'approved' ? <div className={styles.success} data-testid="approval-success">
              <h2 ref={outcome} tabIndex={-1}>{justApproved ? t('success.title') : t('status.approved')}</h2>
              <p>{t('decided.recordedFor', {signer: scope.signer ?? '', date: formatInZone(scope.decided, timeZone)})}</p>
              {justApproved && <p>{t('success.body', {version: scope.version})}</p>}
              {!ro.readonly && <div className={styles.next} data-testid="next-step">
                <strong>{t('success.next')}</strong>
                {depositDue ? <><p>{t('success.payDepositHelp')}</p><a className="primary" href="#pay-deposit">{t('success.payDeposit', {amount: formatMoney(deposit!.amount, deposit!.currency)})}</a></>
                  : openInvoice ? <a className="primary" href="#h-invoices">{t('success.payInvoice', {number: openInvoice.number, amount: formatMoney(openInvoice.open, openInvoice.currency)})}</a>
                    : <p>{t('success.nothing')}</p>}
              </div>}
            </div> : <>
              <h2 ref={outcome} tabIndex={-1}>{t('changes.title')}</h2>
              <p className="section-gap">{t('decided.recordedFor', {signer: scope.signer ?? '', date: formatInZone(scope.decided, timeZone)})}</p>
              <p className="quiet">{t('changes.body')}</p>
            </>}
            {evidence && <EvidenceBlock evidence={evidence} t={t} sealShown={!!ledger} />}
            {scope.comment && <p className="line-list section-gap" data-testid="decision-comment-shown">{scope.comment}</p>}
            {receipt && <div className="muted-box"><strong>{t('receipt.title')}</strong><p className="fine">{t('receipt.body')}</p><p className="mono fine">{t('receipt.version', {version: String(receipt.version), date: `${formatInZone(String(receipt.decided), timeZone)} (${String(receipt.decided)})`})}<br />{t('receipt.code', {code: String(receipt.anchor)})}<br />{t('receipt.seal', {seal: receipt.signature ? String(receipt.signature) : t('receipt.notSealed')})}</p></div>}
            <p className="fine">{t('decided.baselineNote', {version: scope.version})}</p>
          </> : ro.readonly ? <p className="fine" role="note">{t('closed.noActions')}</p> : <>
            <h2>{t('decide.heading')} <em>{t('decide.headingEm')}</em></h2>
            {(linkExpiresText || linkExpires) && <p className="fine" role="note">{t('decide.linkOpenUntil', {date: linkExpiresText ?? formatInZone(linkExpires!, timeZone)})}</p>}
            <p className="quiet section-gap">{t('decide.intro')}</p>
            {identity && <OtpGate token={token} to={identity.to} channel={identity.channel} session={otpSession} onVerified={setOtpSession} />}
            <label>{t('decide.name')}<input id="signer-name" autoComplete="name" aria-required="true" maxLength={120} value={name} onChange={e => setName(e.target.value)} /></label>
            <label>{t('decide.comment')} <span className="quiet">{t('decide.commentHint')}</span><textarea id="decision-comment" rows={3} maxLength={3000} value={comment} onChange={e => setComment(e.target.value)} aria-describedby="comment-kept" /></label>
            <p className="fine" id="comment-kept">{t('decide.commentKept')}</p>
            <label className="consent"><Checkbox id="decide-consent" aria-required="true" aria-invalid={(!!decideError && !checked) || undefined} checked={checked} onCheckedChange={v => { setChecked(v === true); setDecideError(e => afterConsent(e, t('decide.errConsent'), v === true)); }} />{t('decide.consent', {version: scope.version})}</label>
            {decideError && <div className="error" role="alert" id="decide-error"><p className="flush">{decideError}</p>{unavailable && <p className="flush">{resting && <span data-testid="decide-cooldown">{t(cooldown === 1 ? 'decide.retryInOne' : 'decide.retryIn', {seconds: cooldown})} </span>}<a className="help-link" href={tellSenderHref(t, scope.version, typeof location === 'undefined' ? '' : location.href, comment)} data-testid="tell-sender">{t('decide.tellSender')}</a></p>}</div>}
            <div className="actions"><button className="primary" disabled={resting} aria-disabled={busy || resting || (!!identity && !otpSession) || undefined} aria-describedby={[identity && !otpSession ? 'decide-needs-code' : '', decideError ? 'decide-error' : ''].filter(Boolean).join(' ') || undefined} aria-busy={(busy && deciding === 'approved') || undefined} onClick={() => { if (busy) return; if (identity && !otpSession) { setDecideError(t(identity.channel && identity.channel !== 'email' ? 'decide.errCodePhone' : 'decide.errCodeEmail')); return; } void decide('approved'); }}>{busy && deciding === 'approved' ? t('decide.saving') : t('decide.approve')}</button><button className="secondary" disabled={resting} aria-disabled={busy || resting || undefined} aria-describedby={decideError ? 'decide-error' : undefined} aria-busy={(busy && deciding === 'changes_requested') || undefined} onClick={() => { if (busy) return; void decide('changes_requested'); }}>{busy && deciding === 'changes_requested' ? t('decide.saving') : t('decide.requestChanges')}</button></div>
            {identity && !otpSession && <p className="fine" id="decide-needs-code">{t('decide.needsCode')}</p>}
          </>}
          {replaced && decideError && <p className="error" role="alert">{decideError}</p>}
          <p className="fine">{t('decide.fineMoney')}</p>
          <DataNotice lang={lang} retentionDays={data?.retention_days ?? notice?.retention_days ?? null} dataNotice={data?.data_notice ?? null} />{/* integration: the notice endpoint's data_notice is WS-08's English summary of the retention DataNotice already states (translated) from retention_days; showing both repeated it */}
          {/* P3: the identity fine print and the glossary fold into one disclosure; the data notice stays visible. */}
          <details className={styles.glossary}><summary>{t('glossary.title')}</summary><p className="fine flush">{identity ? t(identity.channel && identity.channel !== 'email' ? 'decide.fineCodePhone' : 'decide.fineCodeEmail') : t('decide.fineNoCode')}</p><ul><li>{t('glossary.recordCheck')}</li><li>{t('glossary.seal')}</li><li>{t('glossary.co')}</li></ul></details>
        </section>
        {/* P3: deposit and invoices side by side when both are shown (two-col stacks on phones). */}
        <div className={deposit && ledger?.invoices?.length ? 'two-col money-cols' : undefined}>
        {deposit && <section className="editor no-print deposit-box" id="pay-deposit" tabIndex={-1} aria-labelledby="h-deposit"><h2 id="h-deposit">{t('deposit.title')}</h2>
          {deposit.paid ? <p className="chain ok" role="status">{t('deposit.received', {amount: formatMoney(deposit.paid.amount, deposit.paid.currency)})}{deposit.paid.paid_on ? t('deposit.receivedOn', {date: formatDay(deposit.paid.paid_on)}) : deposit.paid.paid_at ? t('deposit.receivedOn', {date: formatInZone(deposit.paid.paid_at, timeZone)}) : ''}</p>
            : recordedPaid >= deposit.amount ? <p className="chain ok" role="status">{t('deposit.covered', {amount: formatMoney(recordedPaid, deposit.currency)})}</p>
              : <><p className="quiet section-gap">{t('deposit.asks', {pct: deposit.pct})} <strong>{formatMoney(deposit.amount, deposit.currency)}</strong></p>
                {!ro.readonly && !payFilled && (deposit.enabled ? <button className="primary" disabled={paying} aria-busy={paying || undefined} aria-describedby="deposit-help" onClick={payDeposit}>{paying ? t('deposit.opening') : t('deposit.pay', {amount: formatMoney(deposit.amount, deposit.currency)})}</button> : <p className="fine" role="note">{t('deposit.offline')}</p>)}
              </>}
          <p className="fine sr-only" id="deposit-help">{t('deposit.help')}</p><p className="fine" role="status" aria-live="polite">{depositNote || (returned ? t(returned === 'ok' ? 'deposit.returnOk' : 'deposit.returnCancel') : '')}</p></section>}
        {!!ledger?.invoices?.length && <section className="editor no-print" aria-labelledby="h-invoices" id="h-invoices"><h2>{t('invoices.title')}</h2>
          <ul className="receipt-list payment-list">{ledger.invoices.map(i => <li key={i.seq}><span><strong>{i.number}</strong> · {formatMoney(i.amount, i.currency)} · {t('invoices.due', {date: formatDay(i.due)})} · <span className={i.overdue ? 'warn-text' : i.status === 'paid' ? 'ok-text' : ''}>{i.status === 'paid' ? t('invoices.paid') : i.overdue ? t('invoices.overdue') : i.status === 'part' ? t('invoices.partOpen', {amount: formatMoney(i.open, i.currency)}) : t('invoices.open')}</span>{(i as InvoiceShown).tds?.net_receivable !== undefined && <> · <span data-testid="invoice-net-tds">{t('invoices.netTds', {amount: formatMoney((i as InvoiceShown).tds?.net_receivable ?? 0, i.currency)})}</span></>}</span>
            <span className="pay-actions">{!ro.readonly && !payFilled && i.open > 0 && ledger.online_payments && <button className="secondary" disabled={payingInvoice !== null} aria-busy={payingInvoice === i.seq || undefined} onClick={() => void payInvoice(i.seq, i.number)}>{payingInvoice === i.seq ? t('deposit.opening') : t('invoices.pay', {amount: formatMoney(i.open, i.currency)})}<span className="sr-only">{t('invoices.payFor', {number: i.number})}</span></button>}<a className="help-link" href={`/api/review/${token}/invoices/${i.seq}`} download>{t('invoices.pdf')}<span className="sr-only">{t('invoices.pdfOf', {number: i.number})}</span></a></span></li>)}</ul>
          <p className="fine" role="status" aria-live="polite">{invoiceNote}</p><p className="fine">{t('invoices.note')}</p></section>}
        </div>
        {/* WS-04 PayBlock: one mount; it lists every open target itself (deposit, invoices, balance) and preselects the most urgent. */}
        {!ro.readonly && scope.status === 'approved' && <SlotOr name="pay-block" onFilled={setPayFilled}><PayBlock token={token} {...(depositDue ? {purpose: 'deposit' as const} : openInvoice ? {purpose: 'invoice' as const, seq: openInvoice.seq} : {})} onPaid={load} /></SlotOr>}
        {!ro.readonly && cosign && scope.version === scope.latest && <Countersign token={token} content={scope.content} version={scope.version} state={cosign} timeZone={timeZone} identity={identity} otpSession={otpSession} onOtpVerified={setOtpSession} onSigned={load} />}
        {ledger && <AgreementView token={token} scope={scope} ledger={ledger} timeZone={timeZone} onChanged={load} identity={identity} otpSession={otpSession} onOtpVerified={setOtpSession} t={t} lang={lang} readonly={ro.readonly} />}
        <div className="actions section-gap no-print">
          {scope.status !== 'pending' && scope.decided && <a className="primary" href={`/api/review/${token}/receipt?tz=${encodeURIComponent(timeZone)}`} download>{t('actions.receipt')}</a>}
          {ledger && scope.status === 'approved' && scope.version === scope.latest && <a className="secondary" href={`/api/review/${token}/statement?tz=${encodeURIComponent(timeZone)}`} download>{t('actions.statement')}</a>}
          <button className="secondary" onClick={() => window.print()}>{t('actions.print')}</button>
          <Link className="help-link" href="/">{t('actions.create')}</Link>
        </div>
      </>}
    </main>
  </>;
}
