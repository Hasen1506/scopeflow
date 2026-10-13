'use client';
import {LedgerPanel} from '../ledger-panel';
import {ClientNotices} from './client-notices';
import type {Ws} from './state';
import {stepState} from './step-state';

export function changesStep(w:Ws){const {active,coSignal,ledgerReload,onLedgerView,onLedgerError,pendingCos,timeZone}=w;
  return (active&&<section id="step-changes" className="editor flow-step" data-state={stepState(w,'changes')} aria-labelledby="h-changes">
      <div className="step-head"><span className="step-num" aria-hidden="true">3</span><h3 id="h-changes">Changes</h3>{pendingCos>0&&<span className="tag status-changes_requested">{pendingCos} pending</span>}</div>
      <LedgerPanel key={active.project_id+":"+active.version+":"+active.status} timeZone={timeZone} projectId={active.project_id} reviewUrl={active.revoked?null:'/review/'+active.token} onView={onLedgerView} onLoadError={onLedgerError} openChangeOrder={coSignal} reload={ledgerReload}/>
      {/* WS-09 mount (WS-06): "Client emailed · Share on WhatsApp" for pending change orders; nothing until WS-06 lands. */}
      <ClientNotices projectId={active.project_id} list="change_orders" reload={ledgerReload+pendingCos}/>
     </section>
  );
}
