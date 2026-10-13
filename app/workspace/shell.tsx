'use client';
import {useSyncExternalStore} from 'react';
import {linkDialogCopy,decidedStatus} from '@/lib/review-link-copy';
import Link from 'next/link';
import {ArrowUpRight,Plus,Printer,Keyboard,X} from 'lucide-react';
import {Tabs,TabsList,TabsTrigger,TabsContent} from '@/components/ui/tabs';
import {Dialog,DialogContent,DialogTitle,DialogDescription} from '@/components/ui/dialog';
import {formatMoney,hasDepositScheduleConflict,DEPOSIT_SCHEDULE_CONFLICT} from '@/lib/scope';
import {bannerAfterFix} from '@/lib/editor';
import {computable} from '@/lib/money';
import {StageChip,StageTracker,NextStep} from '../workflow';
import {Header,Paper,Skeleton} from '../ui';
import Landing from '../landing';
import {daysAgo} from '@/lib/time';
import {useWorkspace} from './state';
import {projectList} from './project-list';
import {scopeStep} from './editor';
import {approvalStep} from './approval';
import {changesStep} from './changes';
import {paymentStep} from './money';
import {settingsStep} from './settings';

/** Visual #29: true on touch-first devices (no keyboard to press Ctrl S on). Server and first paint: false. */
const COARSE='(pointer: coarse)';
const subscribeCoarse=(cb:()=>void)=>{const m=window.matchMedia?.(COARSE);m?.addEventListener('change',cb);return()=>m?.removeEventListener('change',cb);};
function useCoarsePointer(){return useSyncExternalStore(subscribeCoarse,()=>!!window.matchMedia?.(COARSE).matches,()=>false);}

/** The signed-in workspace and the try-without-account editor (split from app/workspace.tsx, L8: no behaviour change). */
export default function Workspace(){
  const coarse=useCoarsePointer();
  const w=useWorkspace();const {confirmDialog,shortcutsOn,setShortcutsOn,cards,actionError,active,activeOv,busy,changed,deleteText,draft,error,goHome,importDraft,importError,importOpen,importText,isSample,keysOpen,linkAction,loading,manageLink,newScope,next,nextActions,notice,opening,preview,projectAction,runProjectAction,setDeleteText,setImportOpen,setImportText,setKeysOpen,setLinkAction,setNotice,setProjectAction,setTab,setTrying,setUndo,shownAction,shownLink,signedIn,stage,steps,tab,tryEditor,trying,undo,undoReplace}=w;
  // Visual re-audit #6: once the deposit/schedule conflict is fixed (Clear deposit), the banner stops naming it.
  const shownError=bannerAfterFix(error,DEPOSIT_SCHEDULE_CONFLICT,hasDepositScheduleConflict(draft));
  // H4 (WS-02 semantics, WS-09 copy): a decided version's client keeps a read-only copy after revoke/replace.
  const linkCopy=linkDialogCopy(shownLink,decidedStatus(active?.status));
 return <><Header/><main className="shell" id="content" tabIndex={-1}>
  {!signedIn&&!trying?<>{loading&&<div className="boot-skeleton" aria-hidden="true"><Skeleton cards={2} lines={2}/></div>}<div className={loading?'boot-guard':undefined}><Landing onTry={tryEditor}/></div></>:<>
  {!signedIn&&!loading&&<div className="try-banner" role="note"><p><b>Trying Scopeflow without an account.</b> Your draft stays in this tab only. Create an account to save it and send it for approval.</p><div className="actions"><Link className="primary" href="/auth/sign-up?return_to=%2F">Create an account<ArrowUpRight size={16}/></Link><Link className="secondary" href="/auth/sign-in?return_to=%2F">Sign in</Link><button className="help-link" onClick={()=>{setTrying(false);window.scrollTo({top:0});}}>Back to the overview</button></div></div>}
  <div className="page-heading compact hero-in"><div><p className="eyebrow">Your workspace</p><h1>Scopes &amp; <em>agreements</em></h1></div><div className="actions"><button className="secondary" onClick={()=>setKeysOpen(true)} aria-label="Keyboard shortcuts" title={shortcutsOn?'Keyboard shortcuts (?)':'Keyboard shortcuts'} aria-keyshortcuts={shortcutsOn?'?':undefined}><Keyboard size={16}/></button><button className="primary" onClick={()=>void newScope()} aria-keyshortcuts={shortcutsOn?'N':undefined}><Plus size={16}/>New scope</button></div></div>
  <Tabs value={tab} onValueChange={v=>v==='home'?goHome():setTab('project')} className="ws-tabs">
   <TabsList variant="line" aria-label="Workspace"><TabsTrigger value="home">Projects ({cards.filter(c=>c.stage!=='archived').length}){w.unsavedCard?' · 1 draft':''}</TabsTrigger><TabsTrigger value="project" className="tab-project"><span className="tab-ellipsis">{active?active.content.title:isSample?'Example scope':draft.title.trim()||'New scope'}</span></TabsTrigger></TabsList>
   <TabsContent value="home" className="home">
    {projectList(w)}
   </TabsContent>
   <TabsContent value="project" className="project-view">
    {loading&&<div className="boot-skeleton" aria-hidden="true"><Skeleton cards={2} lines={2}/></div>}
    <div className={loading?'boot-guard':undefined}>
    <div id="project-top" className="project-head">
     <div className="ph-title"><div><p className="eyebrow flush">{active?`${draft.client||active.content.client} · version ${active.version}`:isSample?'Example project':'New scope'}</p><h2>{(active?active.content.title:draft.title.trim())||'Untitled scope'}</h2></div><StageChip stage={stage}/></div>
     {opening?<Skeleton lines={2} label="Opening project…"/>:<StageTracker steps={steps}/>}
     <NextStep tone={stage==='changes_requested'||stage==='change_pending'||stage==='archived'?'attention':stage==='approved'?'ok':'info'} title={next.title} actions={nextActions}>{next.kind==='send'&&activeOv?.last_sent?`Emailed ${daysAgo(activeOv.last_sent).text}${activeOv.reminders?` (${activeOv.reminders} reminder${activeOv.reminders>1?'s':''} so far)`:''}. ${activeOv.reminders>=3?'That is the most reminders Scopeflow sends for one version, so contact your client directly.':'A reminder resends the same link with a short note, at most once a day.'} The decision appears here as soon as it is made.`:next.detail}{stage==='approved'&&activeOv&&(activeOv.balance??0)>0&&<> <strong>{formatMoney(activeOv.balance??0,activeOv.currency)} is still to collect</strong>: record payments in step 4 as they arrive.</>}{!active&&!coarse&&<> Press <span className="kbd">Ctrl</span> <span className="kbd">S</span> to save.</>}</NextStep>
    </div>
    <div className="work-grid"><div className={'flow-col'+(!active?' editing':'')}>
     {scopeStep(w)}
     {approvalStep(w)}
     {changesStep(w)}
     {paymentStep(w)}
     {settingsStep(w)}
     <div className="notice-dock">{shownError&&<p className="error" role="alert">{shownError}</p>}{notice&&<p className="muted-box" role="status"><span>{notice}</span><button type="button" className="dismiss" aria-label="Dismiss message" onClick={()=>setNotice('')}><X size={14}/></button></p>}{undo&&<p className="muted-box" role="status"><span>Your previous draft was replaced. <button className="help-link" onClick={undoReplace}>Undo</button> <button className="help-link" onClick={()=>setUndo(null)}>Dismiss</button></span></p>}</div>
    </div>
    <div className="preview-col"><div className="preview-bar no-print"><p className="eyebrow">{active&&!changed?'The locked scope':'Live draft preview'}</p><button className="secondary" onClick={()=>window.print()}><Printer size={16}/>Print / PDF</button></div><Paper scope={computable(preview)} version={active?active.version+(changed?1:0):1} status={active&&!changed?active.status:'draft'}/><p className="fine no-print">A workflow approval record. Reviewer names are self-reported; this is not a verified electronic signature.</p></div></div>
    </div>
   </TabsContent>
  </Tabs></>}</main>
 <Dialog open={keysOpen} onOpenChange={setKeysOpen}><DialogContent><DialogTitle>Keyboard shortcuts</DialogTitle><DialogDescription>Shortcuts work when you are not typing in a field, except saving, which works everywhere in the editor.</DialogDescription><label className="check-row"><input type="checkbox" checked={shortcutsOn} onChange={e=>setShortcutsOn(e.target.checked)}/>Single-key shortcuts (N, P, /, ?, 1–4) <span className="quiet">· turn off if you use speech input or press keys by accident; Ctrl S / ⌘ S and Esc always work</span></label><dl className="verify-details"><dt><span className="kbd">Ctrl</span> <span className="kbd">S</span> / <span className="kbd">⌘</span> <span className="kbd">S</span></dt><dd>Save the scope (same as the save button)</dd><dt><span className="kbd">N</span></dt><dd>New scope</dd><dt><span className="kbd">P</span></dt><dd>Projects home</dd><dt><span className="kbd">/</span></dt><dd>Search your projects</dd><dt><span className="kbd">1</span>–<span className="kbd">4</span></dt><dd>In a project: jump to Scope, Approval, Changes, Payment</dd><dt><span className="kbd">?</span></dt><dd>Show this list</dd><dt><span className="kbd">Esc</span></dt><dd>Close a dialog or menu</dd></dl></DialogContent></Dialog>
 <Dialog open={!!linkAction} onOpenChange={open=>{if(!open&&!busy)setLinkAction(null);}}><DialogContent><DialogTitle>{linkCopy.title}</DialogTitle><DialogDescription>{linkCopy.body}</DialogDescription><div className="actions"><button className="primary" disabled={busy} onClick={manageLink}>{linkCopy.confirm}</button><button className="secondary" disabled={busy} onClick={()=>setLinkAction(null)}>Cancel</button></div></DialogContent></Dialog><Dialog open={importOpen} onOpenChange={setImportOpen}><DialogContent><DialogTitle>Import a draft from JSON</DialogTitle><DialogDescription>Paste the JSON produced using the prompt on the Muse & API page. Importing fills a new draft; it does not save or share it.</DialogDescription><label>Scope JSON<textarea rows={10} value={importText} onChange={e=>setImportText(e.target.value)}/></label>{importError&&<p className="error" role="alert">{importError}</p>}<button className="primary" onClick={importDraft}>Import draft</button></DialogContent></Dialog><Dialog open={!!projectAction} onOpenChange={open=>{if(!open&&!busy){setProjectAction(null);setDeleteText('');}}}><DialogContent><DialogTitle>{shownAction==='delete'?'Delete this project permanently?':shownAction==='archive'?'Archive this project?':'Restore this project?'}</DialogTitle><DialogDescription>{shownAction==='delete'?'This removes every version of this project and its review links. It is only possible because no client has made a decision on it yet. This cannot be undone.':shownAction==='archive'?'The project is hidden from your list and locked against new versions and ledger entries. Signed decisions, change orders and review links stay exactly as they are, and you can restore it at any time.':'The project returns to your list and can be edited again.'}</DialogDescription>{shownAction==='delete'&&<label>Type DELETE to confirm<input autoFocus value={deleteText} onChange={e=>setDeleteText(e.target.value)} autoComplete="off"/></label>}{actionError&&<p className="error" role="alert">{actionError}</p>}<div className="actions"><button className="secondary" disabled={busy} onClick={()=>{setProjectAction(null);setDeleteText('');}}>Cancel</button><button className={shownAction==='delete'?'primary danger':'primary'} disabled={busy||!projectAction||(shownAction==='delete'&&deleteText!=='DELETE')} onClick={runProjectAction}>{shownAction==='delete'?'Delete project':shownAction==='archive'?'Archive project':'Restore project'}</button></div></DialogContent></Dialog>{confirmDialog}</>;
}
