'use client';
import {linkDialogCopy,decidedStatus,reviewMailto} from '@/lib/review-link-copy';
import {useCallback,useEffect,useRef,useState} from 'react';
import {toast} from 'sonner';
import {Scope,Version,Item,scopeSchema,sample,blank,itemLine,hasDepositScheduleConflict,DEPOSIT_SCHEDULE_CONFLICT} from '@/lib/scope';
import {applyOwnerDefaults,draftDefaults,type OwnerDefaults} from '@/lib/profile';
import {type LedgerView} from '../ledger-panel';
import {stageOf,trackerSteps,nextStep} from '@/lib/stage';
import {api,post,type ApiError} from '../ui';
import {rememberSession} from '@/lib/theme';
import {fieldErrors,validationBanner,VALIDATION_BANNER,type FieldIssue,numberProblems,saveBlockReason,draftKey,serializeDraft,normalizeDraft,meaningfulDraft,templateKeep} from '@/lib/editor';
import {templates as starterTemplates} from '@/lib/templates';
import {feeCheck} from '@/lib/money';
import {newProjectZone} from '@/lib/time';
import {type AiStatus} from '../scope-check';
import {type ProjectSettings,type CosignView,type OtpChannel} from '../trust-settings';
import {UnsavedCard} from './project-list';
import {useConfirm} from '../a11y';
import {SHORTCUTS_KEY,shortcutsEnabled,singleKeyShortcutAllowed} from '@/lib/a11y';
import {EMAIL,type Overview,type Tpl,type CosignLink} from './types';
import {registerStageTool} from './stage-tool';
import {restoreOnLoad} from './draft-restore';
import {homeCards,cardActionFor,amountLine,waiting,type Card} from './home-cards';
import {nextActionsFor,toTop} from './next-actions';
import {projectActions} from './project-actions';
import {navGuard} from '@/lib/nav-guard';
export {STALE_DAYS,EMAIL,moneyMap,type OvProject,type Overview,type Tpl,type CosignLink} from './types';



/** All workspace state and actions (moved verbatim from the Workspace component, L8). */
export function useWorkspace(){
 const [query,setQuery]=useState(''),[statusFilter,setStatusFilter]=useState('all'),[linkAction,setLinkAction]=useState<'revoke'|'rotate'|null>(null),[shownLink,setShownLink]=useState<'revoke'|'rotate'>('rotate');
 const [draft,setDraft]=useState<Scope>(sample),[scopes,setScopes]=useState<Version[]>([]),[history,setHistory]=useState<Version[]>([]),[active,setActive]=useState<Version|null>(null),[signedIn,setSignedIn]=useState(false),[busy,setBusy]=useState(false),[loading,setLoading]=useState(true),[error,setError]=useState(''),[notice,setNotice]=useState(''),[tab,setTabState]=useState<'home'|'project'>('project'),[link,setLink]=useState(''),[importOpen,setImportOpen]=useState(false),[importText,setImportText]=useState(''),[importError,setImportError]=useState(''),[isSample,setIsSample]=useState(true),[undo,setUndo]=useState<{draft:Scope;isSample:boolean}|null>(null),[supersede,setSupersede]=useState<{count:number}|null>(null);
 // The owner's navigations and edits: the first load lands on Projects only if the owner did neither meanwhile.
 const nav=useRef(navGuard());const setTab=useCallback((t:'home'|'project')=>{nav.current.bump();setTabState(t);},[]);
 // Project metadata outside the signed content: client email for "Send for signature", archive state.
 const [emailTouched,setEmailTouched]=useState(false),[accountZone,setAccountZone]=useState<string|null>(null),[clientEmail,setClientEmail]=useState(''),[savedEmail,setSavedEmail]=useState(''),[archived,setArchived]=useState<string|null>(null),[mailOn,setMailOn]=useState(false),[sendFallback,setSendFallback]=useState<{to:string;review_url:string;mailto:string}|null>(null),[projectAction,setProjectAction]=useState<'archive'|'restore'|'delete'|null>(null),[shownAction,setShownAction]=useState<'archive'|'restore'|'delete'>('archive'),[deleteText,setDeleteText]=useState(''),[actionError,setActionError]=useState('');
 const [opening,setOpening]=useState(false),[reviseOpen,setReviseOpen]=useState(false),[ledgerView,setLedgerView]=useState<LedgerView|null>(null),[coSignal,setCoSignal]=useState(0),[ledgerReload,setLedgerReload]=useState(0),[insightsOpen,setInsightsOpen]=useState(false);
 const [ledgerError,setLedgerError]=useState('');
 const onLedgerView=useCallback((v:LedgerView)=>{setLedgerView(v);setLedgerError('');},[]);
 const onLedgerError=useCallback((m:string)=>setLedgerError(m),[]);
 // UX-C20: the ledger read for one version/status is not the one for the next (e.g. right after approval).
 const ledgerKey=active?active.project_id+':'+active.version+':'+active.status:'';
 const [ledgerFor,setLedgerFor]=useState(ledgerKey);
 if(ledgerFor!==ledgerKey){setLedgerFor(ledgerKey);setLedgerView(null);setLedgerError('');}
 // PR D: templates library (built-in starters + your own) and AI drafting from a brief.
 const [library,setLibrary]=useState<Tpl[]>(starterTemplates.map(t=>({id:'builtin:'+t.id,name:t.name,content:t.content,builtin:true}))),[fromTemplate,setFromTemplate]=useState<Tpl|null>(null),[tplName,setTplName]=useState(''),[tplOpen,setTplOpen]=useState(false),[ai,setAi]=useState<AiStatus>({enabled:false,provider:null}),[trust,setTrust]=useState<ProjectSettings|null>(null),[cosigns,setCosigns]=useState<CosignView[]>([]),[cosignLinks,setCosignLinks]=useState<CosignLink[]>([]),[linkExpiresAt,setLinkExpiresAt]=useState<string|null>(null),[otpChannels,setOtpChannels]=useState<OtpChannel[]>([]),[aiQuality,setAiQuality]=useState<'fast'|'careful'>('fast'),[brief,setBrief]=useState('');
 // Owner wording pre-filled into new drafts (Data controls > Wording).
 const [defaults,setDefaults]=useState<Partial<Scope>>({exclusions:'',notes:''});
 // PR C: project time zone (owner-private metadata); every timestamp is shown in it.
 const [timeZone,setTimeZone]=useState<string|null>(null);
 // PR B: optional email one-time code before the client signs (project setting, owner-private).
 const landed=useRef(false);
 // Whose browser draft this page shows: undefined until /api/me answers, null when signed out (the
 // draft then lives only in this tab), otherwise the account's opaque key. A draft is only ever restored
 // for the account that typed it.
 const [account,setAccount]=useState<string|null|undefined>(undefined),[trying,setTrying]=useState(false);
 const accountRef=useRef<string|null|undefined>(undefined);
 // Signed in, the unsaved draft is kept with the account (/api/unsaved-draft): autosaved a moment after each
 // edit, restored on any device, kept when signing out. `synced` is the draft text the server holds
 // (null: none, undefined: not known yet). Each write names the account it was typed in.
 const synced=useRef<string|null|undefined>(undefined),syncChain=useRef<Promise<void>>(Promise.resolve()),switching=useRef(false);
 const [draftSync,setDraftSync]=useState<'saving'|'saved'|'error'|null>(null),[keptDraft,setKeptDraft]=useState<Scope|null>(null),[syncRetry,setSyncRetry]=useState(0);
 const syncDraft=useCallback((content:Scope|null,text:string|null,keepalive=false)=>{const acct=accountRef.current;if(!acct||switching.current)return syncChain.current;
  const run=async()=>{setDraftSync('saving');try{if(text===null)await api('/api/unsaved-draft?account='+encodeURIComponent(acct),{method:'DELETE',keepalive});else await api('/api/unsaved-draft',{...post({account:acct,content}),method:'PUT',keepalive});synced.current=text;setKeptDraft(text===null?null:content);setDraftSync(text===null?null:'saved');}
   catch(e){if((e as ApiError).code==='account_changed'){switching.current=true;location.reload();return;}setDraftSync('error');setTimeout(()=>setSyncRetry(n=>n+1),10_000);}};
  syncChain.current=syncChain.current.then(run);return syncChain.current;},[]);
 const [overview,setOverview]=useState<Overview|null>(null);
 const loadOverview=useCallback(async()=>{try{setOverview(await api('/api/overview'));}catch{/* cards fall back to the scope's own fee */}},[]);
 const refresh=useCallback(async function refresh(){const navAt=nav.current.mark();setError('');setLoading(true);try{const me=await api('/api/me');const who:string|null=me.signedIn?String(me.account??''):null;
  // Another account signed in (or out) since this page loaded: start over so nothing of the previous one stays on screen.
  if(accountRef.current!==undefined&&accountRef.current!==who){location.reload();return;}
  if(accountRef.current===undefined){accountRef.current=who;const {stored,from,kept,known,undo:keptUndo}=await restoreOnLoad(who);
   if(known){synced.current=kept?JSON.stringify(kept):null;setKeptDraft(kept);}if(keptUndo)setUndo({draft:keptUndo,isSample:false});
   if(stored){setDraft(stored);setIsSample(false);if(who===null){setTrying(true);setTabState('project');}setNotice(from==='account'?'Restored the unsaved draft kept with your account.':from==='tab'?'Restored your unsaved draft from this tab.':'Restored your unsaved draft from this browser. It is now kept with your account.');}
   setAccount(who);}
  setSignedIn(me.signedIn);rememberSession(!!me.signedIn);setMailOn(!!me.mail);setAccountZone(me.defaults?.timezone??null);if(me.ai)setAi(me.ai);setOtpChannels(me.otp_channels??(me.otp?['email']:[]));if(me.signedIn){const [d]=await Promise.all([api('/api/scopes'),loadOverview()]);setScopes(d.scopes);if(!landed.current){landed.current=true;if(!new URLSearchParams(location.search).get('project')&&nav.current.unchanged(navAt))setTabState('home');}try{const t=await api('/api/templates');setLibrary(t.templates);}catch{/* starters stay available */}try{const [st,pr]=await Promise.all([api('/api/settings'),api('/api/profile').catch(()=>null)]);setDefaults({exclusions:st.settings.default_exclusions??'',notes:st.settings.default_terms??'',...(pr?draftDefaults(pr.profile):{})});}catch{/* defaults stay empty */}}}catch(e){setError((e as Error).message);}finally{setLoading(false);}},[loadOverview]);
 // Load the account, restore an unsaved draft kept in this browser (BUG-14) and open ?project= deep links.
 useEffect(()=>{let live=true;queueMicrotask(()=>{if(live)void refresh();});return()=>{live=false;};},[refresh]);
 // Coming back to this tab after signing in or out elsewhere: re-check who is signed in.
 useEffect(()=>{const check=()=>{if(document.visibilityState!=='visible'||accountRef.current===undefined)return;api('/api/me').then(async me=>{if((me.signedIn?String(me.account??''):null)!==accountRef.current){switching.current=true;location.reload();return;}
  // Same account: take up a draft edited on another device, unless this page has edits still to save.
  const k=keepRef.current;if(!accountRef.current||k.text!==synced.current)return;const r=await api('/api/unsaved-draft');const kept=r.draft?normalizeDraft(r.draft):null;const text=kept?JSON.stringify(kept):null;if(!kept||text===synced.current||keepRef.current.text!==synced.current)return;
  synced.current=text;setKeptDraft(kept);if(!k.active){setDraft(kept);setIsSample(false);setNotice('Updated with the draft you edited on another device.');}},()=>{/* checked again next time */});};document.addEventListener('visibilitychange',check);return()=>document.removeEventListener('visibilitychange',check);},[]);
 // Save what is still waiting before the page goes away or the owner signs out (the header asks first).
 useEffect(()=>{const flush=()=>{const k=keepRef.current;if(k.active||!accountRef.current||switching.current||k.text===synced.current||(k.text===null&&synced.current===undefined))return syncChain.current;return syncDraft(k.content,k.text,true);};
  const onHide=()=>{void flush();};const onFlush=(e:Event)=>{(e as CustomEvent<Promise<unknown>[]>).detail?.push(flush());};
  window.addEventListener('pagehide',onHide);window.addEventListener('scopeflow:flush',onFlush);return()=>{window.removeEventListener('pagehide',onHide);window.removeEventListener('scopeflow:flush',onFlush);void flush();};},[syncDraft]);
 useEffect(()=>registerStageTool(value=>{stash();setDraft(value);setActive(null);setHistory([]);setTab('project');setLink('');setIsSample(false);}),[setTab]);
 // LT-05: while the open version waits on the client, re-read its status when the tab regains focus or
 // becomes visible, and every 15 s, so an approval made elsewhere shows without a reload.
 const awaitingId=active&&active.status==='pending'&&!active.revoked&&!archived?active.project_id+':'+active.version:null;
 useEffect(()=>{if(!awaitingId)return;const [pid,ver]=awaitingId.split(':');let live=true,inFlight=false;
  const poll=async()=>{if(!live||inFlight||document.visibilityState!=='visible')return;inFlight=true;try{const d=await api(`/api/scopes/${pid}`);const latest:Version|undefined=d.versions?.[0];
   if(!live||!latest||String(latest.version)!==ver||latest.status==='pending')return;
   setActive(a=>a&&a.project_id===pid&&String(a.version)===ver?latest:a);setHistory(d.versions);setCosigns(d.cosigns??[]);setCosignLinks(d.cosign_links??[]);setScopes(list=>list.map(x=>x.project_id===pid?latest:x));void loadOverview();}catch{/* try again on the next tick */}finally{inFlight=false;}};
  const onVisible=()=>{if(document.visibilityState==='visible')void poll();};
  const id=setInterval(()=>void poll(),15000);window.addEventListener('focus',onVisible);document.addEventListener('visibilitychange',onVisible);
  return()=>{live=false;clearInterval(id);window.removeEventListener('focus',onVisible);document.removeEventListener('visibilitychange',onVisible);};},[awaitingId,loadOverview]);
 // LT-06: field-level validation messages; editing a field clears its message and the banner.
 const [fieldErrs,setFieldErrs]=useState<Record<string,string>>({});
 function clearFieldError(k:string){setFieldErrs(prev=>{if(!(k in prev))return prev;const n={...prev};delete n[k];return n;});setError(e=>e.startsWith(VALIDATION_BANNER)?'':e);}
 function field<K extends keyof Scope>(k:K,value:Scope[K]){nav.current.bump();setDraft(x=>({...x,[k]:value}));setIsSample(false);setNotice('');clearFieldError(k);}
 // Keep a copy of the draft whenever something replaces it, so it can be undone (BUG-14).
 const draftRef=useRef<{draft:Scope;isSample:boolean;saved?:Scope}>({draft,isSample});useEffect(()=>{draftRef.current={draft,isSample,saved:active?.content};});
 // A saved project shown unchanged is not a draft: leaving it loses nothing, so no Undo notice.
 function stash(){const current=draftRef.current;if(current.saved&&JSON.stringify(current.saved)===JSON.stringify(current.draft))return;if(meaningfulDraft(current.draft,sample,blank))setUndo({draft:current.draft,isSample:current.isSample});}
 function undoReplace(){if(!undo)return;setDraft(undo.draft);setIsSample(undo.isSample);setActive(null);setHistory([]);setLink('');setUndo(null);setNotice('Previous draft restored.');}
 function setItems(items:Item[]){nav.current.bump();setDraft(x=>({...x,items,deliverables:items.map(itemLine).join('\n')}));setIsSample(false);setNotice('');clearFieldError('deliverables');}
 const creationRequest=useRef<{fingerprint:string;key:string}|null>(null);
 const dirty=active?JSON.stringify(draft)!==JSON.stringify(active.content):!isSample&&JSON.stringify(draft)!==JSON.stringify(blank)&&JSON.stringify(draft)!==JSON.stringify({...blank,...defaults});
 // R3-12: no leave-page warning once the draft is safely kept with the account (it is restored on return).
 const draftKept=()=>{const k=keepRef.current;return !k.active&&!!accountRef.current&&k.text!==null&&k.text===synced.current;};
 useEffect(()=>{if(!dirty)return;const warn=(event:BeforeUnloadEvent)=>{if(draftKept())return;event.preventDefault();event.returnValue='';};window.addEventListener('beforeunload',warn);return()=>window.removeEventListener('beforeunload',warn);},[dirty]);
 // A draft worth keeping: not the example, not an empty form, not just the owner's default wording.
 const keepText=!active&&account!==undefined&&meaningfulDraft(draft,sample,blank)&&JSON.stringify(draft)!==JSON.stringify({...blank,...defaults})?JSON.stringify(draft):null;
 const keepRef=useRef<{content:Scope;text:string|null;active:boolean}>({content:draft,text:null,active:false});useEffect(()=>{keepRef.current={content:draft,text:keepText,active:!!active};});
 useEffect(()=>{if(active||account===undefined)return;
  // Signed out: this tab only.
  if(account===null){const key=draftKey(null);const id=setTimeout(()=>{try{if(keepText!==null)sessionStorage.setItem(key,serializeDraft(draft,Date.now(),null));else sessionStorage.removeItem(key);}catch{/* storage unavailable */}},300);return()=>clearTimeout(id);}
  if(keepText===synced.current||(keepText===null&&synced.current===undefined))return;
  const id=setTimeout(()=>{void syncDraft(keepText===null?null:draft,keepText);},1200);return()=>clearTimeout(id);},[draft,active,account,keepText,syncDraft,syncRetry]);
 function tryEditor(){setTrying(true);setTab('project');requestAnimationFrame(()=>window.scrollTo({top:0}));}
 // UX-C41/N1: replacing an unsaved draft is confirmed in the in-app dialog too.
 const [confirm,confirmDialog]=useConfirm();
 // R3-01: a draft that differs from a fresh one only in its name and client is not replaced by a template (both are kept).
 const nameOnly=()=>!active&&[blank,{...blank,...defaults}].some(b=>JSON.stringify({...draft,title:b.title,client:b.client})===JSON.stringify(b));
 // o.nameOk: the caller keeps name and client. o.keptOk: the caller leaves the draft where it is (R3-12, opening a project).
 async function canReplace(o:{nameOk?:boolean;keptOk?:boolean}={}){return !dirty||(o.nameOk&&nameOnly())||(o.keptOk&&draftKept())||await confirm({title:'Replace this unsaved draft?',body:'Your saved versions will stay in project history.',confirmLabel:'Replace draft',cancelLabel:'Keep editing'});}
 async function newScope(o:{nameOk?:boolean}={}){if(!(await canReplace(o)))return false;if(!(o.nameOk&&nameOnly()))stash();setReviseOpen(false);setLedgerView(null);creationRequest.current=null;setActive(null);setHistory([]);setClientEmail('');setSavedEmail('');setArchived(null);setFromTemplate(null);setTimeZone(null);setTrust(null);setCosigns([]);setCosignLinks([]);setLinkExpiresAt(null);setSendFallback(null);setDraft({...blank,...defaults});setIsSample(false);setLink('');setNotice('');setError('');setTrying(true);setTab('project');return true;}
 // Open /?project=<id> (links returned to MCP clients) once projects are loaded.
 const opened=useRef(false);
 useEffect(()=>{if(opened.current||!signedIn||!scopes.length)return;const id=new URLSearchParams(location.search).get('project');const match=id&&scopes.find(x=>x.project_id===id);if(!match)return;opened.current=true;queueMicrotask(()=>{void select(match);});});
 async function duplicateDraft(){if(!active||!(await newScope()))return;setDraft({...active.content,title:(active.content.title+' / new scope').slice(0,160),client:'',fee:0,due:''});setNotice('Scope reused as a new draft. Set the client, fee, and delivery date before saving.');}
 async function select(s:Version,then?:'revise'|'change_order'){if(!(await canReplace({keptOk:true})))return;creationRequest.current=null;setBusy(true);setOpening(true);setTab('project');setLedgerView(null);setReviseOpen(then==='revise');setError('');setNotice('');try{const d=await api(`/api/scopes/${s.project_id}`);const latest=d.versions[0];setActive(latest);setHistory(d.versions);setClientEmail(d.project?.client_email??'');setSavedEmail(d.project?.client_email??'');setArchived(d.project?.archived??null);setTimeZone(d.project?.timezone??null);setTrust(d.project??null);setCosigns(d.cosigns??[]);setCosignLinks(d.cosign_links??[]);setLinkExpiresAt(d.project?.link_expires??null);setSendFallback(null);setDraft(latest.content);setLink('');setIsSample(false);setTab('project');if(then==='change_order')setCoSignal(n=>n+1);requestAnimationFrame(()=>toTop(then==='revise'?'step-scope':null));}catch(e){setError((e as Error).message);}finally{setBusy(false);setOpening(false);}}
 async function save(confirmSupersede=false){setError('');setNotice('');setSupersede(null);setFieldErrs({});const parsed=scopeSchema.safeParse(draft);if(!parsed.success){const f=fieldErrors(parsed.error.issues as FieldIssue[]);setFieldErrs(f);setError(validationBanner(f,hasDepositScheduleConflict(draft)?DEPOSIT_SCHEDULE_CONFLICT:null));/* UX-C36: take the owner to the first field to fix */requestAnimationFrame(()=>document.querySelector<HTMLElement>('#step-scope [aria-invalid=true]')?.focus());return;}if(!signedIn){setError('Sign in before saving a scope.');return;}const email=clientEmail.trim().toLowerCase();if(email&&!EMAIL.test(email)){setError('Client email: enter a valid email address, or leave it empty.');return;}setBusy(true);try{const fingerprint=JSON.stringify(parsed.data);if(!active&&creationRequest.current?.fingerprint!==fingerprint)creationRequest.current={fingerprint,key:crypto.randomUUID()};const result=active?await api(`/api/scopes/${active.project_id}`,post({content:parsed.data,expected_version:active.version,...(confirmSupersede?{supersede_agreement:true}:{})})):await api('/api/scopes',{...post(parsed.data),headers:{'Content-Type':'application/json','Idempotency-Key':creationRequest.current!.key}});creationRequest.current=null;setActive(result.scope);setHistory(h=>[result.scope,...h]);setScopes(s=>[result.scope,...s.filter(x=>x.project_id!==result.scope.project_id)]);setLink(location.origin+result.review_path);setIsSample(false);setSendFallback(null);let emailNote='';if(!active){const tz=newProjectZone(accountZone,Intl.DateTimeFormat().resolvedOptions().timeZone);if(tz){try{const m=await api(`/api/scopes/${result.scope.project_id}`,{...post({timezone:tz}),method:'PATCH'});setTimeZone(m.project.timezone);}catch{/* zone stays unset (UTC) */}}}if(email!==savedEmail){try{const m=await api(`/api/scopes/${result.scope.project_id}`,{...post({client_email:email}),method:'PATCH'});setSavedEmail(m.project.client_email);}catch(e){emailNote=' The client email was not saved: '+(e as Error).message;}}setNotice(`Version ${result.scope.version} saved. Its contents are now fixed.`+emailNote);setReviseOpen(false);requestAnimationFrame(()=>toTop(null));void loadOverview();setUndo(null);void syncDraft(null,null);}catch(e){const err=e as ApiError;if(err.code==='agreement_has_ledger'){setSupersede({count:Number(err.data?.ledger_entries??0)});}else if(err.data?.fields&&typeof err.data.fields==='object'&&Object.keys(err.data.fields).length){const f=Object.fromEntries(Object.entries(err.data.fields as Record<string,unknown>).map(([k,v])=>[k==='items'?'deliverables':k.split('.')[0]==='items'?'deliverables':k,String(v)]));setFieldErrs(f);setError(validationBanner(f));}else setError(err.message);}finally{setBusy(false);}}
 // SF-06: start a revision from the current agreement (baseline + approved change orders).
 async function startFromAgreement(){if(!active)return;setBusy(true);setError('');try{const l=await api(`/api/scopes/${active.project_id}/ledger`);const a=l.agreement;if(!a){setError('There is no approved agreement to start from.');return;}const items=a.items.map(({source:_source,...i}:{source:unknown}&Item)=>i);setDraft(x=>({...x,items,deliverables:items.map(itemLine).join('\n'),fee:a.fee,revisions:a.revisions_allowed,due:a.due}));setSupersede(null);setNotice('Draft updated from the current agreement: approved change orders, fee, rounds and delivery date are folded in. Review it, then save.');}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
 async function copy(value:string,what='Link'){try{await navigator.clipboard.writeText(value);toast.success(what+' copied to clipboard.');}catch{setNotice('Select the link and copy it manually.');}}
 // One click: show this version's review link and copy it (was Show review link, then Copy link).
 // #43/N4: copy only (no /send round-trip); with a valid client email, offer the mail-app draft for the same link.
 async function copyLinkToSend(){const url=await copyReviewLink();const email=clientEmail.trim().toLowerCase();if(!url||!active)return;setSendFallback(EMAIL.test(email)?{to:email,review_url:url,mailto:reviewMailto(email,{title:active.content.title,client:active.content.client,version:active.version,reviewUrl:url})}:null);}
 async function copyReviewLink(){if(!active||active.revoked)return null;const url=location.origin+'/review/'+active.token;setLink(url);await copy(url,'Review link');return url;}
 async function importDraft(){let value:Scope;try{value=scopeSchema.parse(JSON.parse(importText));}catch{setImportError('Use the complete Scopeflow JSON format from the Muse & API page.');return;}if(!(await canReplace()))return;stash();creationRequest.current=null;setDraft(value);setActive(null);setHistory([]);setLink('');setIsSample(false);setImportOpen(false);setTab('project');setNotice('Draft imported. Check the details before saving.');}
 async function manageLink(){if(!active||!linkAction)return;setBusy(true);setError('');try{const result=await api(`/api/scopes/${active.project_id}/review-link`,post({version:active.version,action:linkAction}));const d=await api(`/api/scopes/${active.project_id}`);setActive(d.versions[0]);setHistory(d.versions);setScopes(s=>s.map(v=>v.project_id===active.project_id?d.versions[0]:v));setLink(result.review_path?location.origin+result.review_path:'');setNotice(linkDialogCopy(linkAction,decidedStatus(active.status)).done);setLinkAction(null);}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
 // Project mail and metadata actions (export, client email, send for signature, reminders, time zone).
 const {exportProject,saveEmail,sendForSignature,remind,saveTimeZone}=projectActions({active,busy,clientEmail,setBusy,setError,setNotice,setSavedEmail,setClientEmail,setSendFallback,setTimeZone,loadOverview,select});
 // Archive / restore / delete one project (owner-only, confirmed in a dialog).
 async function runProjectAction(){if(!active||!projectAction)return;const id=active.project_id;setBusy(true);setActionError('');try{if(projectAction==='delete'){await api(`/api/scopes/${id}`,{...post({confirmation:deleteText}),method:'DELETE'});setScopes(s=>s.filter(x=>x.project_id!==id));creationRequest.current=null;setActive(null);setHistory([]);setDraft(blank);setIsSample(false);setLink('');setClientEmail('');setSavedEmail('');setArchived(null);setSendFallback(null);setNotice('Project deleted.');}else{const r=await api(`/api/scopes/${id}`,{...post({archived:projectAction==='archive'}),method:'PATCH'});setArchived(r.project.archived);setScopes(s=>s.map(x=>x.project_id===id?{...x,archived:r.project.archived}:x));setNotice(projectAction==='archive'?'Project archived. Its signed record and review links are kept; restore it to keep working on it.':'Project restored.');}setProjectAction(null);setDeleteText('');}catch(e){setActionError((e as Error).message);}finally{setBusy(false);}}
 function optional<K extends 'tax_label'|'tax_pct'|'deposit_pct'|'payment_terms'|'milestones'|'fx'|'revision_bank'>(k:K,value:Scope[K]|undefined){nav.current.bump();setDraft(x=>{const next={...x};if(value===undefined||value==='')delete next[k];else next[k]=value as Scope[K];return next;});setIsSample(false);setNotice('');}
 // WS-09 part D: re-read the open project after a slot (ContactChange, CosignerEditor) changed it, without touching the draft.
 async function reloadProject(){if(!active)return;try{const d=await api(`/api/scopes/${active.project_id}`);setHistory(d.versions);setActive(d.versions[0]);setTrust(d.project??null);setSavedEmail(d.project?.client_email??'');setCosigns(d.cosigns??[]);setCosignLinks(d.cosign_links??[]);setLinkExpiresAt(d.project?.link_expires??null);}catch(e){setError((e as Error).message);}}
 // UX-C65: "Refresh decision" re-reads the open version only: no project re-open, no replace-draft prompt, no scroll.
 async function refreshDecision(){if(!active||busy)return;const id=active.project_id;setBusy(true);setError('');try{const d=await api(`/api/scopes/${id}`);const latest:Version=d.versions[0];setActive(latest);setHistory(d.versions);setCosigns(d.cosigns??[]);setCosignLinks(d.cosign_links??[]);setScopes(list=>list.map(x=>x.project_id===id?latest:x));void loadOverview();setNotice(latest.status==='pending'?'Checked just now: still waiting for the client.':`Checked just now: the client’s decision is in (${latest.status.replace('_',' ')}).`);}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
 /** Stages a template; `keep` (the typed name, client and client email, R4-05/06; by default from the current draft) is merged in the same update. Resolves false when nothing was applied. */
 async function applyTemplate(id:string,keep=templateKeep({active:!!active,isSample,draft,clientEmail})){const t=library.find(x=>x.id===id);if(!t||!(await newScope({nameOk:true})))return false;const {email,...names}=keep;setDraft({...(t.builtin?applyOwnerDefaults({...t.content},defaults as OwnerDefaults):{...t.content}),...names});if(email)setClientEmail(email);setFromTemplate(t);setNotice(t.builtin?`Starter template staged${Object.keys(defaults).some(k=>(defaults as Record<string,unknown>)[k])?' with your default terms':''}. Edit it freely; set ${names.client?'the':'the client,'} price and exact quantities before saving.`:`Your template “${t.name}” is staged. Edit it, then save the scope or update the template.`);return true;}
 // SF-18: "Use template" on the Templates section opens /?template=<id>; stage it once the library has loaded.
 const tplApplied=useRef(false);useEffect(()=>{if(tplApplied.current||loading)return;const id=new URLSearchParams(location.search).get('template');if(!id||!library.some(x=>x.id===id))return;tplApplied.current=true;queueMicrotask(()=>{void applyTemplate(id);window.history.replaceState(null,'',location.pathname);});});
 async function saveTemplate(update:boolean){const content={...draft,fee:Number.isFinite(draft.fee)?draft.fee:0,revisions:Number.isFinite(draft.revisions)?draft.revisions:0};setBusy(true);setError('');try{const r=update&&fromTemplate&&!fromTemplate.builtin?await api(`/api/templates/${fromTemplate.id}`,{...post({content,...(tplName.trim()?{name:tplName.trim()}:{})}),method:'PUT'}):await api('/api/templates',post({name:tplName.trim(),content}));setLibrary(l=>[...l.filter(x=>x.id!==r.template.id),r.template]);setFromTemplate(r.template);setTplOpen(false);setTplName('');setNotice(update?`Template “${r.template.name}” updated.`:`Saved as template “${r.template.name}”.`);}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
 // UX-C41: deleting a template is confirmed in an in-app dialog (themed, focus-trapped), not window.confirm.
 async function deleteTemplate(t:Tpl){if(t.builtin||!(await confirm({title:`Delete your template “${t.name}”?`,body:'Scopes made from it are not affected.',consequence:'The template is removed from your library for good.',confirmLabel:'Delete template',cancelLabel:'Keep it',danger:true})))return;setBusy(true);setError('');try{await api(`/api/templates/${t.id}`,{method:'DELETE',headers:{'Content-Type':'application/json'}});setLibrary(l=>l.filter(x=>x.id!==t.id));if(fromTemplate?.id===t.id)setFromTemplate(null);setNotice(`Template “${t.name}” deleted.`);}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
 async function draftWithAi(){if(!ai.enabled||busy)return;setBusy(true);setError('');try{const r=await api('/api/draft',post({brief,currency:draft.currency,quality:aiQuality}));if(!(await newScope()))return;setDraft(r.draft);setFromTemplate(null);setNotice(`AI draft staged in the editor${r.owner_defaults?.length?' with your default terms':''}. Nothing was saved or sent: check every deliverable, the fee and the terms before saving.`);}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
 // The project dialog keeps the wording of the action it was opened for while it animates closed
 // (projectAction is already null then); otherwise it briefly read "Restore project" after an archive.
 if(projectAction&&projectAction!==shownAction)setShownAction(projectAction);
 // Same for the review-link dialog: while it animates closed linkAction is already null, so it
 // briefly read "Replace this review link?" / "Confirm replacement" after a revocation.
 if(linkAction&&linkAction!==shownLink)setShownLink(linkAction);
 const changed=!!active&&JSON.stringify(draft)!==JSON.stringify(active.content);
 const problems=numberProblems(draft);
 const fees=feeCheck({...draft,fee:Number.isFinite(draft.fee)?draft.fee:0});
 const blockReason=saveBlockReason({busy,signedIn,loading,editingSaved:!!active,changed});
 // Keyboard: Ctrl/⌘+S saves from anywhere in the editor; "/" searches projects; "?" lists shortcuts.
 const [keysOpen,setKeysOpen]=useState(false);
 // UX-C45 (WCAG 2.1.4): single-key shortcuts can be turned off in the shortcuts dialog; the choice stays in this browser.
 const [shortcutsOn,setShortcutsOnState]=useState(true);
 useEffect(()=>{try{const on=shortcutsEnabled(localStorage.getItem(SHORTCUTS_KEY));if(!on)queueMicrotask(()=>setShortcutsOnState(false));}catch{/* storage unavailable: shortcuts stay on */}},[]);
 function setShortcutsOn(on:boolean){setShortcutsOnState(on);try{if(on)localStorage.removeItem(SHORTCUTS_KEY);else localStorage.setItem(SHORTCUTS_KEY,'off');}catch{/* kept for this page only */}}
 function goHome(){setTab('home');if(signedIn){void loadOverview();api('/api/scopes').then(d=>setScopes(d.scopes),()=>{/* keep the list we have */});}}
 const homeRef=useRef(goHome);useEffect(()=>{homeRef.current=signedIn?goHome:()=>{setTrying(false);setTab('project');window.scrollTo({top:0});};});
 const searchRef=useRef<HTMLInputElement>(null);
 const keyHandler=useRef<(e:KeyboardEvent)=>void>(()=>{});
 useEffect(()=>{keyHandler.current=(e:KeyboardEvent)=>{
  if((e.metaKey||e.ctrlKey)&&!e.altKey&&!e.shiftKey&&e.key.toLowerCase()==='s'){if(tab!=='project'||document.querySelector('[role=dialog]'))return;e.preventDefault();if(!busy&&!blockReason)void save();return;}
  const target=e.target as HTMLElement|null;
  if(!singleKeyShortcutAllowed({key:e.key,ctrlKey:e.ctrlKey,metaKey:e.metaKey,altKey:e.altKey,enabled:shortcutsOn,overlayOpen:!!document.querySelector('[role=dialog][data-state=open],[role=alertdialog][data-state=open],[role=menu][data-state=open]'),inField:!!target?.closest('input,textarea,select,[contenteditable="true"],[role=combobox],[role=listbox]')}))return;
  if(e.key==='/'){e.preventDefault();goHome();requestAnimationFrame(()=>setTimeout(()=>searchRef.current?.focus(),0));}
  else if(e.key==='?'){e.preventDefault();setKeysOpen(true);}
  else if(e.key==='n'){e.preventDefault();void newScope();}
  else if(e.key==='p'){e.preventDefault();goHome();}
  else if(tab==='project'&&/^[1-4]$/.test(e.key)){const id=['step-scope','step-approval','step-changes','step-payment'][Number(e.key)-1];const el=document.getElementById(id);if(el){e.preventDefault();toTop(id);}}
 };});
 useEffect(()=>{const onKey=(e:KeyboardEvent)=>keyHandler.current(e);const onHome=()=>homeRef.current();window.addEventListener('keydown',onKey);window.addEventListener('scopeflow:home',onHome);return()=>{window.removeEventListener('keydown',onKey);window.removeEventListener('scopeflow:home',onHome);};},[]);
 const hasMoneyTerms=!!(draft.tax_label||draft.tax_pct||draft.deposit_pct||draft.payment_terms||draft.milestones||draft.fx||draft.revision_bank);
 const moneySummary=[draft.tax_pct?`${draft.tax_label||'Tax'} ${draft.tax_pct}%`:'',draft.deposit_pct?`${draft.deposit_pct}% deposit`:'',draft.milestones?`${draft.milestones.length} milestone${draft.milestones.length===1?'':'s'}`:'',draft.fx?`in ${draft.fx.currency} too`:'',draft.revision_bank?'revision bank':'',draft.payment_terms?'payment terms':''].filter(Boolean).join(' · ');
 const preview={...draft,fee:Number.isFinite(draft.fee)?draft.fee:0,revisions:Number.isFinite(draft.revisions)?draft.revisions:0};
 // ---- Where the open project stands (stage, tracker, next step) ----------------------------------
 const ovById=new Map((overview?.projects??[]).map(p=>[p.project_id,p]));
 const activeOv=active?ovById.get(active.project_id):undefined;
 const pendingCos=ledgerView?.agreement?.pending??activeOv?.pending_changes??0;
 const stageInput={saved:!!active,status:active?.status,revoked:active?.revoked,archived,pendingChanges:pendingCos,client:draft.client};
 const stage=stageOf(stageInput),steps=trackerSteps(stageInput),next=nextStep(stageInput);
 const receiptUrl=(v:Version)=>`/api/scopes/${v.project_id}/receipt?version=${v.version}&tz=${encodeURIComponent(timeZone??'UTC')}`;
 const calloutCopies=!!active&&!archived&&(next.kind==='send'||next.kind==='copy_link');
 const nextActions=nextActionsFor({active,signedIn,loading,next,archived,activeOv,busy,mailOn,remind,sendForSignature,copyLinkToSend,copyReviewLink,setReviseOpen,receiptUrl,setCoSignal,setActionError,setProjectAction});
 // ---- Projects home ---------------------------------------------------------------------------
 const {cards,filtered,count,urgent,dueByCurrency,dueCount}=homeCards(scopes,ovById,overview,statusFilter,query);
 const unsaved=signedIn&&!active&&!isSample&&meaningfulDraft(draft,sample,blank);
 // The draft kept with the account stays one tap away while another project is open.
 const unsavedCard=unsaved?<UnsavedCard title={draft.title} sync={draftSync} onOpen={()=>setTab('project')}/>:signedIn&&active&&keptDraft?<UnsavedCard title={keptDraft.title} sync={null} onOpen={()=>{const kept=keptDraft;void newScope().then(ok=>{if(ok){setDraft(kept);setNotice('Your unsaved draft is open again.');}});}}/>:null;
 const ins=overview?.insights;
 const cardAction=(c:Card)=>cardActionFor(c,{busy,remind,copy,select});
  return {accountZone,refreshDecision,emailTouched,setEmailTouched,confirmDialog,shortcutsOn,setShortcutsOn,fieldErrs,query,setQuery,statusFilter,setStatusFilter,linkAction,setLinkAction,shownLink,draft,setDraft,scopes,history,active,signedIn,busy,loading,error,notice,setNotice,tab,setTab,link,importOpen,setImportOpen,importText,setImportText,importError,setImportError,isSample,setIsSample,undo,setUndo,supersede,setSupersede,clientEmail,setClientEmail,savedEmail,archived,sendFallback,setSendFallback,projectAction,setProjectAction,shownAction,deleteText,setDeleteText,actionError,setActionError,opening,reviseOpen,setReviseOpen,ledgerView,ledgerError,onLedgerError,coSignal,ledgerReload,setLedgerReload,insightsOpen,setInsightsOpen,onLedgerView,library,fromTemplate,tplName,setTplName,tplOpen,setTplOpen,ai,trust,setTrust,cosigns,cosignLinks,reloadProject,linkExpiresAt,otpChannels,aiQuality,setAiQuality,brief,setBrief,timeZone,trying,setTrying,draftSync,overview,loadOverview,field,undoReplace,setItems,tryEditor,newScope,duplicateDraft,select,save,startFromAgreement,copy,copyReviewLink,importDraft,manageLink,exportProject,saveEmail,remind,runProjectAction,optional,saveTimeZone,applyTemplate,saveTemplate,deleteTemplate,draftWithAi,changed,problems,fees,blockReason,keysOpen,setKeysOpen,goHome,searchRef,hasMoneyTerms,moneySummary,preview,activeOv,pendingCos,stage,steps,next,receiptUrl,calloutCopies,nextActions,cards,filtered,count,urgent,unsavedCard,ins,dueByCurrency,dueCount,waiting,cardAction,amountLine};
}
export type Ws=ReturnType<typeof useWorkspace>;
