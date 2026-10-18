'use client';
import {useSyncExternalStore} from 'react';
import {SESSION_HINT_KEY} from '@/lib/theme';
import {linkDialogCopy,decidedStatus} from '@/lib/review-link-copy';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import {ArrowUpRight,Plus,Keyboard} from 'lucide-react';
import {Tabs,TabsList,TabsTrigger,TabsContent} from '@/components/ui/tabs';
import {Dialog,DialogContent,DialogTitle,DialogDescription} from '@/components/ui/dialog';
import {Header,Skeleton} from '../ui';
import Landing from '../landing';
import {useWorkspace} from './state';
import {projectList} from './project-list';

// Editor, ledger and preview stay out of the project-list load.
const ProjectBody = dynamic(() => import('./project-body'), {
  loading: () => <div className="boot-skeleton" aria-hidden="true"><Skeleton cards={2} lines={2}/></div>,
});

/** Visual #29: true on touch-first devices (no keyboard to press Ctrl S on). Server and first paint: false. */
const COARSE='(pointer: coarse)';
const subscribeCoarse=(cb:()=>void)=>{const m=window.matchMedia?.(COARSE);m?.addEventListener('change',cb);return()=>m?.removeEventListener('change',cb);};
function useCoarsePointer(){return useSyncExternalStore(subscribeCoarse,()=>!!window.matchMedia?.(COARSE).matches,()=>false);}
const subscribeHint=(cb:()=>void)=>{const onStorage=(e:StorageEvent)=>{if(!e.key||e.key===SESSION_HINT_KEY)cb();};window.addEventListener('storage',onStorage);const obs=new MutationObserver(cb);obs.observe(document.documentElement,{attributes:true,attributeFilter:['data-auth']});return()=>{window.removeEventListener('storage',onStorage);obs.disconnect();};};
function authHinted(){try{return localStorage.getItem(SESSION_HINT_KEY)==='1'||document.documentElement.dataset.auth==='in';}catch{return false;}}
function useAuthHint(){return useSyncExternalStore(subscribeHint,authHinted,()=>false);}

/** The signed-in workspace and the try-without-account editor (split from app/workspace.tsx, L8: no behaviour change). */
export default function Workspace({initialTrying = false}: {initialTrying?: boolean}){
  const coarse=useCoarsePointer();
  const hinted=useAuthHint();
  const w=useWorkspace(initialTrying);const {confirmDialog,shortcutsOn,setShortcutsOn,cards,actionError,active,busy,deleteText,draft,goHome,importDraft,importError,importOpen,importText,isSample,keysOpen,linkAction,loading,manageLink,newScope,projectAction,runProjectAction,setDeleteText,setImportOpen,setImportText,setKeysOpen,setLinkAction,setProjectAction,setTab,setTrying,shownAction,shownLink,signedIn,tab,tryEditor,trying}=w;
  // H4 (WS-02 semantics, WS-09 copy): a decided version's client keeps a read-only copy after revoke/replace.
  const linkCopy=linkDialogCopy(shownLink,decidedStatus(active?.status));
 return <><Header/><main className="shell" id="content" tabIndex={-1}>
  {!signedIn&&!trying&&(!loading||!hinted)?<>{loading&&<div className="boot-skeleton" aria-hidden="true"><Skeleton cards={2} lines={2}/></div>}<div className={loading?'boot-guard':undefined}><Landing onTry={tryEditor}/></div></>:<>
  {!signedIn&&!loading&&<div className="try-banner" role="note"><p><b>Trying Scopeflow without an account.</b> Your draft stays in this tab only. Create an account to save it and send it for approval.</p><div className="actions"><Link className="primary" href="/auth/sign-up?return_to=%2F">Create an account<ArrowUpRight size={16}/></Link><Link className="secondary" href="/auth/sign-in?return_to=%2F">Sign in</Link><button className="help-link" onClick={()=>{setTrying(false);window.scrollTo({top:0});}}>Back to the overview</button></div></div>}
  <div className="page-heading compact hero-in"><div><p className="eyebrow">Your workspace</p><h1>Scopes &amp; <em>agreements</em></h1></div><div className="actions"><button className="secondary" onClick={()=>setKeysOpen(true)} aria-label="Keyboard shortcuts" title={shortcutsOn?'Keyboard shortcuts (?)':'Keyboard shortcuts'} aria-keyshortcuts={shortcutsOn?'?':undefined}><Keyboard size={16}/></button><button className="primary" onClick={()=>void newScope()} aria-keyshortcuts={shortcutsOn?'N':undefined}><Plus size={16}/>New scope</button></div></div>
  <Tabs value={tab} onValueChange={v=>v==='home'?goHome():setTab('project')} className="ws-tabs">
   <TabsList variant="line" aria-label="Workspace"><TabsTrigger value="home">Projects ({cards.filter(c=>c.stage!=='archived').length}){w.unsavedCard?' · 1 draft':''}</TabsTrigger><TabsTrigger value="project" className="tab-project"><span className="tab-ellipsis">{active?active.content.title:isSample?'Example scope':draft.title.trim()||'New scope'}</span></TabsTrigger></TabsList>
   <TabsContent value="home" className="home">
    {projectList(w)}
   </TabsContent>
   <TabsContent value="project" className="project-view">
    {loading&&<div className="boot-skeleton" aria-hidden="true"><Skeleton cards={2} lines={2}/></div>}
    {!loading&&tab==='project'&&<ProjectBody w={w} coarse={coarse}/>}
   </TabsContent>
  </Tabs></>}</main>
 <Dialog open={keysOpen} onOpenChange={setKeysOpen}><DialogContent><DialogTitle>Keyboard shortcuts</DialogTitle><DialogDescription>Shortcuts work when you are not typing in a field, except saving, which works everywhere in the editor.</DialogDescription><label className="check-row"><input type="checkbox" checked={shortcutsOn} onChange={e=>setShortcutsOn(e.target.checked)}/>Single-key shortcuts (N, P, /, ?, 1–4) <span className="quiet">· turn off if you use speech input or press keys by accident; Ctrl S / ⌘ S and Esc always work</span></label><dl className="verify-details"><dt><span className="kbd">Ctrl</span> <span className="kbd">S</span> / <span className="kbd">⌘</span> <span className="kbd">S</span></dt><dd>Save the scope (same as the save button)</dd><dt><span className="kbd">N</span></dt><dd>New scope</dd><dt><span className="kbd">P</span></dt><dd>Projects home</dd><dt><span className="kbd">/</span></dt><dd>Search your projects</dd><dt><span className="kbd">1</span>–<span className="kbd">4</span></dt><dd>In a project: jump to Scope, Approval, Changes, Payment</dd><dt><span className="kbd">?</span></dt><dd>Show this list</dd><dt><span className="kbd">Esc</span></dt><dd>Close a dialog or menu</dd></dl></DialogContent></Dialog>
 <Dialog open={!!linkAction} onOpenChange={open=>{if(!open&&!busy)setLinkAction(null);}}><DialogContent><DialogTitle>{linkCopy.title}</DialogTitle><DialogDescription>{linkCopy.body}</DialogDescription><div className="actions"><button className="primary" disabled={busy} onClick={manageLink}>{linkCopy.confirm}</button><button className="secondary" disabled={busy} onClick={()=>setLinkAction(null)}>Cancel</button></div></DialogContent></Dialog><Dialog open={importOpen} onOpenChange={setImportOpen}><DialogContent><DialogTitle>Import a draft from JSON</DialogTitle><DialogDescription>Paste the JSON produced using the prompt on the Muse & API page. Importing fills a new draft; it does not save or share it.</DialogDescription><label>Scope JSON<textarea rows={10} value={importText} onChange={e=>setImportText(e.target.value)}/></label>{importError&&<p className="error" role="alert">{importError}</p>}<button className="primary" onClick={importDraft}>Import draft</button></DialogContent></Dialog><Dialog open={!!projectAction} onOpenChange={open=>{if(!open&&!busy){setProjectAction(null);setDeleteText('');}}}><DialogContent><DialogTitle>{shownAction==='delete'?'Delete this project permanently?':shownAction==='archive'?'Archive this project?':'Restore this project?'}</DialogTitle><DialogDescription>{shownAction==='delete'?'This removes every version of this project and its review links. It is only possible because no client has made a decision on it yet. This cannot be undone.':shownAction==='archive'?'The project is hidden from your list and locked against new versions and ledger entries. Signed decisions, change orders and review links stay exactly as they are, and you can restore it at any time.':'The project returns to your list and can be edited again.'}</DialogDescription>{shownAction==='delete'&&<label>Type DELETE to confirm<input autoFocus value={deleteText} onChange={e=>setDeleteText(e.target.value)} autoComplete="off"/></label>}{actionError&&<p className="error" role="alert">{actionError}</p>}<div className="actions"><button className="secondary" disabled={busy} onClick={()=>{setProjectAction(null);setDeleteText('');}}>Cancel</button><button className={shownAction==='delete'?'primary danger':'primary'} disabled={busy||!projectAction||(shownAction==='delete'&&deleteText!=='DELETE')} onClick={runProjectAction}>{shownAction==='delete'?'Delete project':shownAction==='archive'?'Archive project':'Restore project'}</button></div></DialogContent></Dialog>{confirmDialog}</>;
}
