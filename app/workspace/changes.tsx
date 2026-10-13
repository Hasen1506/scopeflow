'use client';
import {LedgerPanel} from '../ledger-panel';
import type {Ws} from './state';

export function changesStep(w:Ws){const {active,coSignal,ledgerReload,onLedgerView,pendingCos,timeZone}=w;
  return (active&&<section id="step-changes" className="editor flow-step" aria-labelledby="h-changes">
      <div className="step-head"><span className="step-num" aria-hidden="true">3</span><h3 id="h-changes">Changes</h3>{pendingCos>0&&<span className="tag status-changes_requested">{pendingCos} pending</span>}</div>
      <LedgerPanel key={active.project_id+":"+active.version+":"+active.status} timeZone={timeZone} projectId={active.project_id} reviewUrl={active.revoked?null:'/review/'+active.token} onView={onLedgerView} openChangeOrder={coSignal} reload={ledgerReload}/>
     </section>
  );
}
