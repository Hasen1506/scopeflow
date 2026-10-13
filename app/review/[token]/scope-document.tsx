'use client';
import {Check, FileText} from 'lucide-react';
import {formatMoney, itemsOf, money, type Scope} from '@/lib/scope';
import {fxLine, itemPriceView, schedule, totals} from '@/lib/money';
import {formatDay} from '@/lib/time';
import type {Translate} from '@/lib/i18n';

// The scope as the client approves it (owner: WS-07). Same markup and classes as app/ui.tsx Paper
// (WS-09), with the page chrome translated (SF-09). Everything the creator wrote (title, client,
// deliverables, acceptance, terms, notes, exclusions) and every amount is shown exactly as written.
// In English the text is identical to Paper's. `firstApproved` relabels the fee once change orders
// have changed it (LT-01): this card is the agreement as first approved, not as it stands now.
export function ScopeDocument({scope, version = 1, status = 'pending', t, firstApproved = false}: {scope: Scope; version?: number; status?: string; t: Translate; firstApproved?: boolean}) {
  const tt = totals(scope), plan = schedule(scope, tt.total);
  return (
    <section className="paper">
      <div className="paper-head"><span className="eyebrow">{t('doc.scopeOfWork')}</span><span>V.{String(version).padStart(2, '0')}</span></div>
      <h2>{scope.title || t('doc.untitled')}</h2>
      <p className="quiet">{t('doc.preparedFor', {client: scope.client || t('doc.yourClient')})}</p>
      <div className="rule" />
      <p className="eyebrow doc-making">{t('doc.making')}</p>
      {itemsOf(scope).map(i => <div className="deliverable" key={i.id}><Check size={18} /><span><span>{i.title}</span>{(i.qty > 1 || i.unit) && <span className="item-qty">× {i.qty}{i.unit ? ' ' + i.unit : ''}</span>}{i.acceptance && <span className="item-accept-line">{t('doc.doneWhen', {criteria: i.acceptance})}</span>}</span>{(() => { const pv = itemPriceView(i, scope.currency); return pv && <span className="item-price"><span>{formatMoney(pv.line, scope.currency)}</span>{pv.each != null && <span className="item-price-note">{t('doc.priceEach', {amount: formatMoney(pv.each, scope.currency)})}</span>}{pv.forAll != null && <span className="item-price-note">{t('doc.priceForAll', {qty: pv.forAll})}</span>}</span>; })()}</div>)}
      <div className="scope-stats"><div><span>{t(firstApproved ? 'doc.feeFirstApproved' : 'doc.projectFee')}</span><strong>{money(scope)}</strong></div><div><span>{t('doc.revisions')}</span><strong>{t('doc.rounds', {count: scope.revisions})}</strong></div></div>
      {(tt.tax_pct > 0 || tt.deposit_pct > 0 || scope.payment_terms) && <div className="section-gap terms">
        {tt.tax_pct > 0 && <><p className="terms-line"><span>{t('doc.taxLine', {label: tt.tax_label, rate: tt.tax_pct})}</span><strong>{formatMoney(tt.tax, scope.currency)}</strong></p><p className="terms-line"><span>{t('doc.totalIncl', {label: tt.tax_label})}</span><strong>{formatMoney(tt.total, scope.currency)}</strong></p></>}
        {tt.deposit_pct > 0 && <p className="terms-line"><span>{t('doc.depositLine', {pct: tt.deposit_pct})}</span><strong>{formatMoney(tt.deposit, scope.currency)}</strong></p>}
        {scope.payment_terms && <p className="line-list section-gap"><strong>{t('doc.paymentTerms')}</strong><br />{scope.payment_terms}</p>}
      </div>}
      {plan.length > 0 && <div className="section-gap terms"><p className="eyebrow">{t('doc.schedule')}</p>{plan.map(l => <p className="terms-line" key={l.id}><span>{l.title} ({l.pct}%){l.due ? ` · ${t('doc.due', {date: formatDay(l.due)})}` : ''}</span><strong>{formatMoney(l.amount, scope.currency)}</strong></p>)}</div>}
      {scope.fx && <p className="fine section-gap">{fxLine(scope, tt.total)}. {t('doc.fxFixed')}</p>}
      {scope.revision_bank && <p className="section-gap"><strong>{t(scope.revision_bank.unit === 'hours' ? 'doc.revisionHours' : 'doc.revisionBudget')}</strong><br />{scope.revision_bank.unit === 'hours' ? t('doc.hoursIncluded', {hours: scope.revision_bank.amount}) : t('doc.budgetIncluded', {amount: formatMoney(scope.revision_bank.amount, scope.currency)})}{scope.revision_bank.overage_rate ? t('doc.overage', {rate: formatMoney(scope.revision_bank.overage_rate, scope.currency)}) : ''}</p>}
      {scope.due && <p className="section-gap"><strong>{t('doc.delivery')}</strong><br />{formatDay(scope.due)}</p>}
      {!!scope.client_inputs?.length && <div className="section-gap"><p className="eyebrow">{t('doc.clientProvides')}</p>{scope.client_inputs.map(c => <p className="line-list" key={c.id}>{c.title}{c.due ? <span className="quiet"> · {t('doc.by', {date: formatDay(c.due)})}</span> : null}</p>)}</div>}
      {scope.exclusions && <div className="section-gap"><p className="eyebrow">{t('doc.outside')}</p><p className="line-list">{scope.exclusions}</p></div>}
      {scope.notes && <div className="section-gap note"><FileText size={20} /><div><strong>{t('doc.working')}</strong><p className="line-list">{scope.notes}</p></div></div>}
      <div className="paper-footer"><span>{t('doc.prepared')}</span><span>{t('status.' + status)}</span></div>
    </section>
  );
}
