'use client';
import {Printer, X} from 'lucide-react';
import {formatMoney, hasDepositScheduleConflict, DEPOSIT_SCHEDULE_CONFLICT} from '@/lib/scope';
import {bannerAfterFix} from '@/lib/editor';
import {computable} from '@/lib/money';
import {daysAgo} from '@/lib/time';
import {StageChip, StageTracker, NextStep} from '../workflow';
import {Paper} from '../paper';
import {Skeleton} from '../ui';
import {scopeStep} from './editor';
import {approvalStep} from './approval';
import {changesStep} from './changes';
import {paymentStep} from './money';
import {settingsStep} from './settings';
import type {useWorkspace} from './state';

type Workspace = ReturnType<typeof useWorkspace>;

/** Editor, ledger and live preview. Loaded only after the project tab is actually shown. */
export default function ProjectBody({w, coarse}: {w: Workspace; coarse: boolean}) {
  const {active, activeOv, changed, draft, error, isSample, next, nextActions, notice, opening, preview, setNotice, setUndo, stage, steps, undo, undoReplace} = w;
  const shownError = bannerAfterFix(error, DEPOSIT_SCHEDULE_CONFLICT, hasDepositScheduleConflict(draft));
  return <>
    <div id="project-top" className="project-head">
     <div className="ph-title"><div><p className="eyebrow flush">{active ? `${draft.client || active.content.client} · version ${active.version}` : isSample ? 'Example project' : 'New scope'}</p><h2>{(active ? active.content.title : draft.title.trim()) || 'Untitled scope'}</h2></div><StageChip stage={stage}/></div>
     {opening ? <Skeleton lines={2} label="Opening project…"/> : <StageTracker steps={steps}/>}
     <NextStep tone={stage === 'changes_requested' || stage === 'change_pending' || stage === 'archived' ? 'attention' : stage === 'approved' ? 'ok' : 'info'} title={next.title} actions={nextActions}>{next.kind === 'send' && activeOv?.last_sent ? `Emailed ${daysAgo(activeOv.last_sent).text}${activeOv.reminders ? ` (${activeOv.reminders} reminder${activeOv.reminders > 1 ? 's' : ''} so far)` : ''}. ${activeOv.reminders >= 3 ? 'That is the most reminders Scopeflow sends for one version, so contact your client directly.' : 'A reminder resends the same link with a short note, at most once a day.'} The decision appears here as soon as it is made.` : next.detail}{stage === 'approved' && activeOv && (activeOv.balance ?? 0) > 0 && <> <strong>{formatMoney(activeOv.balance ?? 0, activeOv.currency)} is still to collect</strong>: record payments in step 4 as they arrive.</>}{!active && !coarse && <> Press <span className="kbd">Ctrl</span> <span className="kbd">S</span> to save.</>}</NextStep>
    </div>
    <div className="work-grid"><div className={'flow-col' + (!active ? ' editing' : '')}>
     {scopeStep(w)}
     {approvalStep(w)}
     {changesStep(w)}
     {paymentStep(w)}
     {settingsStep(w)}
     <div className="notice-dock">{shownError && <p className="error" role="alert">{shownError}</p>}{notice && <p className="muted-box" role="status"><span>{notice}</span><button type="button" className="dismiss" aria-label="Dismiss message" onClick={() => setNotice('')}><X size={14}/></button></p>}{undo && <p className="muted-box" role="status"><span>Your previous draft was replaced. <button className="help-link" onClick={undoReplace}>Undo</button> <button className="help-link" onClick={() => setUndo(null)}>Dismiss</button></span></p>}</div>
    </div>
    <div className="preview-col"><div className="preview-bar no-print"><p className="eyebrow">{active && !changed ? 'The locked scope' : 'Live draft preview'}</p><button className="secondary" onClick={() => window.print()}><Printer size={16}/>Print / PDF</button></div><Paper scope={computable(preview)} version={active ? active.version + (changed ? 1 : 0) : 1} status={active && !changed ? active.status : 'draft'}/><p className="fine no-print">A workflow approval record. Reviewer names are self-reported; this is not a verified electronic signature.</p></div></div>
  </>;
}
