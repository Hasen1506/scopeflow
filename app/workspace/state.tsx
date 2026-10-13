'use client';
import Link from 'next/link';
import {useCallback,useEffect,useRef,useState} from 'react';
import {Copy,Download,FilePlus2,BellRing} from 'lucide-react';
import {toast} from 'sonner';
import {Scope,Version,Item,scopeSchema,sample,blank,money,itemLine,formatMoney} from '@/lib/scope';
import {applyOwnerDefaults,draftDefaults,type OwnerDefaults} from '@/lib/profile';
import {type LedgerView} from '../ledger-panel';
import {stageOf,trackerSteps,nextStep,type StageId} from '@/lib/stage';
import type {Insights} from '@/lib/insights';
import {api,post,type ApiError} from '../ui';
import {rememberSession} from '@/lib/theme';
import {numberProblems,saveBlockReason,LEGACY_DRAFT_KEY,draftKey,clearDrafts,serializeDraft,restoreDraft,normalizeDraft,meaningfulDraft} from '@/lib/editor';
import {templates as starterTemplates} from '@/lib/templates';
import {currencyCodes} from '@/lib/currency';
import {feeCheck} from '@/lib/money';
import {daysAgo,validTimeZone} from '@/lib/time';
import {type AiStatus} from '../scope-check';
import {type ProjectSettings,type CosignView,type OtpChannel} from '../trust-settings';
import {UnsavedCard} from './project-list';

/** A scope still unanswered after this many days gets a gentle "worth a nudge" on its card. */
export const STALE_DAYS=5;
export const EMAIL=/^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export type OvProject={project_id:string;version:number;currency:string;quoted_fee:number;quoted_total:number;agreed_fee:number|null;agreed_total:number|null;pending_changes:number;pending_value:number;approved_changes:number;deposit_due:number|null;paid:number;balance:number|null;last_sent:string|null;reminders:number;viewed:{first:string;last:string;count:number}|null};
export type Overview={projects:OvProject[];insights:Insights;online_deposits:boolean};
export const moneyMap=(m:Record<string,number>)=>Object.entries(m).filter(([,v])=>v).map(([c,v])=>formatMoney(v,c)).join(' + ')||'—';

export type Tpl={id:string;name:string;content:Scope;builtin:boolean};

/** All workspace state and actions (moved verbatim from the Workspace component, L8). */
export function useWorkspace(){
 const [query,setQuery]=useState(''),[statusFilter,setStatusFilter]=useState('all'),[linkAction,setLinkAction]=useState<'revoke'|'rotate'|null>(null),[shownLink,setShownLink]=useState<'revoke'|'rotate'>('rotate');
 const [draft,setDraft]=useState<Scope>(sample),[scopes,setScopes]=useState<Version[]>([]),[history,setHistory]=useState<Version[]>([]),[active,setActive]=useState<Version|null>(null),[signedIn,setSignedIn]=useState(false),[busy,setBusy]=useState(false),[loading,setLoading]=useState(true),[error,setError]=useState(''),[notice,setNotice]=useState(''),[tab,setTab]=useState<'home'|'project'>('project'),[link,setLink]=useState(''),[importOpen,setImportOpen]=useState(false),[importText,setImportText]=useState(''),[importError,setImportError]=useState(''),[isSample,setIsSample]=useState(true),[undo,setUndo]=useState<{draft:Scope;isSample:boolean}|null>(null),[supersede,setSupersede]=useState<{count:number}|null>(null);
 // Project metadata outside the signed content: client email for "Send for signature", archive state.
 const [clientEmail,setClientEmail]=useState(''),[savedEmail,setSavedEmail]=useState(''),[archived,setArchived]=useState<string|null>(null),[mailOn,setMailOn]=useState(false),[sendFallback,setSendFallback]=useState<{to:string;review_url:string;mailto:string}|null>(null),[projectAction,setProjectAction]=useState<'archive'|'restore'|'delete'|null>(null),[shownAction,setShownAction]=useState<'archive'|'restore'|'delete'>('archive'),[deleteText,setDeleteText]=useState(''),[actionError,setActionError]=useState('');
 const [opening,setOpening]=useState(false),[reviseOpen,setReviseOpen]=useState(false),[ledgerView,setLedgerView]=useState<LedgerView|null>(null),[coSignal,setCoSignal]=useState(0),[ledgerReload,setLedgerReload]=useState(0),[insightsOpen,setInsightsOpen]=useState(false);
 const onLedgerView=useCallback((v:LedgerView)=>setLedgerView(v),[]);
 function toTop(id:string|null){const el=document.getElementById(id??'project-top');el?.scrollIntoView?.({block:'start',behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'});}
 // PR D: templates library (built-in starters + your own) and AI drafting from a brief.
 const [library,setLibrary]=useState<Tpl[]>(starterTemplates.map(t=>({id:'builtin:'+t.id,name:t.name,content:t.content,builtin:true}))),[fromTemplate,setFromTemplate]=useState<Tpl|null>(null),[tplName,setTplName]=useState(''),[tplOpen,setTplOpen]=useState(false),[ai,setAi]=useState<AiStatus>({enabled:false,provider:null}),[trust,setTrust]=useState<ProjectSettings|null>(null),[cosigns,setCosigns]=useState<CosignView[]>([]),[linkExpiresAt,setLinkExpiresAt]=useState<string|null>(null),[otpChannels,setOtpChannels]=useState<OtpChannel[]>([]),[aiQuality,setAiQuality]=useState<'fast'|'careful'>('fast'),[brief,setBrief]=useState('');
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
 const refresh=useCallback(async function refresh(){setError('');setLoading(true);try{const me=await api('/api/me');const who:string|null=me.signedIn?String(me.account??''):null;
  // Another account signed in (or out) since this page loaded: start over so nothing of the previous one stays on screen.
  if(accountRef.current!==undefined&&accountRef.current!==who){location.reload();return;}
  if(accountRef.current===undefined){accountRef.current=who;let stored:Scope|null=null,from:'tab'|'account'|'browser'|null=null,anon:Scope|null=null,local:Scope|null=null;const now=Date.now();
   const keep=(d:Scope|null)=>!!d&&meaningfulDraft(d,sample,blank);
   try{localStorage.removeItem(LEGACY_DRAFT_KEY);anon=restoreDraft(sessionStorage.getItem(draftKey(null)),now,null);
    // Signed in: nothing stays in the browser. A draft an earlier build kept here moves to the account.
    if(who!==null){local=restoreDraft(localStorage.getItem(draftKey(who)),now,who);clearDrafts(localStorage);sessionStorage.removeItem(draftKey(null));}
   }catch{/* storage unavailable */}
   if(who===null){if(keep(anon)){stored=anon;from='tab';}}
   else{let kept:Scope|null=null,known=false;try{const r=await api('/api/unsaved-draft');kept=r.draft?normalizeDraft(r.draft):null;known=true;}catch{/* draft service unavailable: autosave still writes, never deletes */}
    if(known){synced.current=kept?JSON.stringify(kept):null;setKeptDraft(kept);}
    // What was typed signed out in this tab comes first (Undo brings the account's draft back), then the account's draft.
    if(keep(anon)){stored=anon;from='tab';if(keep(kept))setUndo({draft:kept!,isSample:false});}else if(keep(kept)){stored=kept;from='account';}else if(keep(local)){stored=local;from='browser';}}
   if(stored){setDraft(stored);setIsSample(false);if(who===null){setTrying(true);setTab('project');}setNotice(from==='account'?'Restored the unsaved draft kept with your account.':from==='tab'?'Restored your unsaved draft from this tab.':'Restored your unsaved draft from this browser. It is now kept with your account.');}
   setAccount(who);}
  setSignedIn(me.signedIn);rememberSession(!!me.signedIn);setMailOn(!!me.mail);if(me.ai)setAi(me.ai);setOtpChannels(me.otp_channels??(me.otp?['email']:[]));if(me.signedIn){const [d]=await Promise.all([api('/api/scopes'),loadOverview()]);setScopes(d.scopes);if(!landed.current){landed.current=true;if(!new URLSearchParams(location.search).get('project'))setTab('home');}try{const t=await api('/api/templates');setLibrary(t.templates);}catch{/* starters stay available */}try{const [st,pr]=await Promise.all([api('/api/settings'),api('/api/profile').catch(()=>null)]);setDefaults({exclusions:st.settings.default_exclusions??'',notes:st.settings.default_terms??'',...(pr?draftDefaults(pr.profile):{})});}catch{/* defaults stay empty */}}}catch(e){setError((e as Error).message);}finally{setLoading(false);}},[loadOverview]);
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
 useEffect(()=>{const context=(document as Document&{modelContext?:{registerTool?:(tool:unknown,options:unknown)=>unknown}}).modelContext;if(!context?.registerTool)return;const lifecycle=new AbortController();Promise.resolve(context.registerTool({name:'stage_scope_draft',title:'Stage a scope for review',description:'Fill the visible scope editor. Does not save, share, approve, or send the scope.',inputSchema:{type:'object',properties:{title:{type:'string'},client:{type:'string'},deliverables:{type:'string',description:'Empty string when items is provided'},items:{type:'array',items:{type:'object',properties:{id:{type:'string'},title:{type:'string'},qty:{type:'integer'},unit:{type:'string'},price:{type:['number','null']},acceptance:{type:'string'}},required:['id','title'],additionalProperties:false}},client_inputs:{type:'array',items:{type:'object',properties:{id:{type:'string'},title:{type:'string'},due:{type:'string'}},required:['id','title'],additionalProperties:false}},exclusions:{type:'string'},fee:{type:'number'},currency:{type:'string',enum:currencyCodes},revisions:{type:'integer'},due:{type:'string'},notes:{type:'string'}},required:['title','client','deliverables','exclusions','fee','currency','revisions','due','notes'],additionalProperties:false},annotations:{readOnlyHint:false,untrustedContentHint:false},execute(input:unknown){const value=scopeSchema.parse(input);stash();setDraft(value);setActive(null);setHistory([]);setTab('project');setLink('');setIsSample(false);return {staged:true,saved:false,title:value.title};}},{signal:lifecycle.signal})).catch(()=>{});return()=>lifecycle.abort();},[]);
 function field<K extends keyof Scope>(k:K,value:Scope[K]){setDraft(x=>({...x,[k]:value}));setIsSample(false);setNotice('');}
 // Keep a copy of the draft whenever something replaces it, so it can be undone (BUG-14).
 const draftRef=useRef<{draft:Scope;isSample:boolean;saved?:Scope}>({draft,isSample});useEffect(()=>{draftRef.current={draft,isSample,saved:active?.content};});
 // A saved project shown unchanged is not a draft: leaving it loses nothing, so no Undo notice.
 function stash(){const current=draftRef.current;if(current.saved&&JSON.stringify(current.saved)===JSON.stringify(current.draft))return;if(meaningfulDraft(current.draft,sample,blank))setUndo({draft:current.draft,isSample:current.isSample});}
 function undoReplace(){if(!undo)return;setDraft(undo.draft);setIsSample(undo.isSample);setActive(null);setHistory([]);setLink('');setUndo(null);setNotice('Previous draft restored.');}
 function setItems(items:Item[]){setDraft(x=>({...x,items,deliverables:items.map(itemLine).join('\n')}));setIsSample(false);setNotice('');}
 const creationRequest=useRef<{fingerprint:string;key:string}|null>(null);
 const dirty=active?JSON.stringify(draft)!==JSON.stringify(active.content):!isSample&&JSON.stringify(draft)!==JSON.stringify(blank)&&JSON.stringify(draft)!==JSON.stringify({...blank,...defaults});
 useEffect(()=>{if(!dirty)return;const warn=(event:BeforeUnloadEvent)=>{event.preventDefault();event.returnValue='';};window.addEventListener('beforeunload',warn);return()=>window.removeEventListener('beforeunload',warn);},[dirty]);
 // A draft worth keeping: not the example, not an empty form, not just the owner's default wording.
 const keepText=!active&&account!==undefined&&meaningfulDraft(draft,sample,blank)&&JSON.stringify(draft)!==JSON.stringify({...blank,...defaults})?JSON.stringify(draft):null;
 const keepRef=useRef<{content:Scope;text:string|null;active:boolean}>({content:draft,text:null,active:false});useEffect(()=>{keepRef.current={content:draft,text:keepText,active:!!active};});
 useEffect(()=>{if(active||account===undefined)return;
  // Signed out: this tab only.
  if(account===null){const key=draftKey(null);const id=setTimeout(()=>{try{if(keepText!==null)sessionStorage.setItem(key,serializeDraft(draft,Date.now(),null));else sessionStorage.removeItem(key);}catch{/* storage unavailable */}},300);return()=>clearTimeout(id);}
  if(keepText===synced.current||(keepText===null&&synced.current===undefined))return;
  const id=setTimeout(()=>{void syncDraft(keepText===null?null:draft,keepText);},1200);return()=>clearTimeout(id);},[draft,active,account,keepText,syncDraft,syncRetry]);
 function tryEditor(){setTrying(true);setTab('project');requestAnimationFrame(()=>window.scrollTo({top:0}));}
 function canReplace(){return !dirty||window.confirm('Replace this unsaved draft? Your saved versions will stay in project history.');}
 function newScope(){if(!canReplace())return false;stash();setReviseOpen(false);setLedgerView(null);creationRequest.current=null;setActive(null);setHistory([]);setClientEmail('');setSavedEmail('');setArchived(null);setFromTemplate(null);setTimeZone(null);setTrust(null);setCosigns([]);setLinkExpiresAt(null);setSendFallback(null);setDraft({...blank,...defaults});setIsSample(false);setLink('');setNotice('');setError('');setTrying(true);setTab('project');return true;}
 // Open /?project=<id> (links returned to MCP clients) once projects are loaded.
 const opened=useRef(false);
 useEffect(()=>{if(opened.current||!signedIn||!scopes.length)return;const id=new URLSearchParams(location.search).get('project');const match=id&&scopes.find(x=>x.project_id===id);if(!match)return;opened.current=true;queueMicrotask(()=>{void select(match);});});
 function duplicateDraft(){if(!active||!newScope())return;setDraft({...active.content,title:(active.content.title+' / new scope').slice(0,160),client:'',fee:0,due:''});setNotice('Scope reused as a new draft. Set the client, fee, and delivery date before saving.');}
 async function select(s:Version,then?:'revise'|'change_order'){if(!canReplace())return;creationRequest.current=null;setBusy(true);setOpening(true);setTab('project');setLedgerView(null);setReviseOpen(then==='revise');setError('');setNotice('');try{const d=await api(`/api/scopes/${s.project_id}`);const latest=d.versions[0];setActive(latest);setHistory(d.versions);setClientEmail(d.project?.client_email??'');setSavedEmail(d.project?.client_email??'');setArchived(d.project?.archived??null);setTimeZone(d.project?.timezone??null);setTrust(d.project??null);setCosigns(d.cosigns??[]);setLinkExpiresAt(d.project?.link_expires??null);setSendFallback(null);setDraft(latest.content);setLink('');setIsSample(false);setTab('project');if(then==='change_order')setCoSignal(n=>n+1);requestAnimationFrame(()=>toTop(then==='revise'?'step-scope':null));}catch(e){setError((e as Error).message);}finally{setBusy(false);setOpening(false);}}
 async function save(confirmSupersede=false){setError('');setNotice('');setSupersede(null);const parsed=scopeSchema.safeParse(draft);if(!parsed.success){setError(parsed.error.issues.map(i=>`${i.path.join('.')}: ${i.message}`).join('; '));return;}if(!signedIn){setError('Sign in before saving a scope.');return;}const email=clientEmail.trim().toLowerCase();if(email&&!EMAIL.test(email)){setError('Client email: enter a valid email address, or leave it empty.');return;}setBusy(true);try{const fingerprint=JSON.stringify(parsed.data);if(!active&&creationRequest.current?.fingerprint!==fingerprint)creationRequest.current={fingerprint,key:crypto.randomUUID()};const result=active?await api(`/api/scopes/${active.project_id}`,post({content:parsed.data,expected_version:active.version,...(confirmSupersede?{supersede_agreement:true}:{})})):await api('/api/scopes',{...post(parsed.data),headers:{'Content-Type':'application/json','Idempotency-Key':creationRequest.current!.key}});creationRequest.current=null;setActive(result.scope);setHistory(h=>[result.scope,...h]);setScopes(s=>[result.scope,...s.filter(x=>x.project_id!==result.scope.project_id)]);setLink(location.origin+result.review_path);setIsSample(false);setSendFallback(null);let emailNote='';if(!active){const tz=Intl.DateTimeFormat().resolvedOptions().timeZone;if(validTimeZone(tz)){try{const m=await api(`/api/scopes/${result.scope.project_id}`,{...post({timezone:tz}),method:'PATCH'});setTimeZone(m.project.timezone);}catch{/* zone stays unset (UTC) */}}}if(email!==savedEmail){try{const m=await api(`/api/scopes/${result.scope.project_id}`,{...post({client_email:email}),method:'PATCH'});setSavedEmail(m.project.client_email);}catch(e){emailNote=' The client email was not saved: '+(e as Error).message;}}setNotice(`Version ${result.scope.version} saved. Its contents are now fixed.`+emailNote);setReviseOpen(false);requestAnimationFrame(()=>toTop(null));void loadOverview();setUndo(null);void syncDraft(null,null);}catch(e){const err=e as ApiError;if(err.code==='agreement_has_ledger'){setSupersede({count:Number(err.data?.ledger_entries??0)});}else setError(err.message);}finally{setBusy(false);}}
 // SF-06: start a revision from the current agreement (baseline + approved change orders).
 async function startFromAgreement(){if(!active)return;setBusy(true);setError('');try{const l=await api(`/api/scopes/${active.project_id}/ledger`);const a=l.agreement;if(!a){setError('There is no approved agreement to start from.');return;}const items=a.items.map(({source:_source,...i}:{source:unknown}&Item)=>i);setDraft(x=>({...x,items,deliverables:items.map(itemLine).join('\n'),fee:a.fee,revisions:a.revisions_allowed,due:a.due}));setSupersede(null);setNotice('Draft updated from the current agreement: approved change orders, fee, rounds and delivery date are folded in. Review it, then save.');}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
 async function copy(value:string,what='Link'){try{await navigator.clipboard.writeText(value);toast.success(what+' copied to clipboard.');}catch{setNotice('Select the link and copy it manually.');}}
 // One click: show this version's review link and copy it (was Show review link, then Copy link).
 async function copyReviewLink(){if(!active||active.revoked)return;const url=location.origin+'/review/'+active.token;setLink(url);await copy(url,'Review link');}
 function importDraft(){try{const value=scopeSchema.parse(JSON.parse(importText));if(!canReplace())return;stash();creationRequest.current=null;setDraft(value);setActive(null);setHistory([]);setLink('');setIsSample(false);setImportOpen(false);setTab('project');setNotice('Draft imported. Check the details before saving.');}catch{setImportError('Use the complete Scopeflow JSON format from the Muse & API page.');}}
 async function manageLink(){if(!active||!linkAction)return;setBusy(true);setError('');try{const result=await api(`/api/scopes/${active.project_id}/review-link`,post({version:active.version,action:linkAction}));const d=await api(`/api/scopes/${active.project_id}`);setActive(d.versions[0]);setHistory(d.versions);setScopes(s=>s.map(v=>v.project_id===active.project_id?d.versions[0]:v));setLink(result.review_path?location.origin+result.review_path:'');setNotice(result.revoked?'Review link revoked. Saved decisions remain in your history.':'Link replaced. The previous link no longer works.');setLinkAction(null);}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
 async function exportProject(){if(!active||busy)return;setBusy(true);setError('');try{const data=await api(`/api/scopes/${active.project_id}/export`);const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download='scopeflow-project-'+active.project_id+'.json';a.click();URL.revokeObjectURL(url);setNotice('Project exported with every version and ledger entry. Store this private file securely.');}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
 async function saveEmail(){if(!active||busy)return;const email=clientEmail.trim().toLowerCase();if(email&&!EMAIL.test(email)){setError('Client email: enter a valid email address, or leave it empty.');return;}setBusy(true);setError('');try{const m=await api(`/api/scopes/${active.project_id}`,{...post({client_email:email}),method:'PATCH'});setSavedEmail(m.project.client_email);setClientEmail(m.project.client_email);setNotice(email?'Client email saved. It is private to you and not part of the signed scope.':'Client email removed.');}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
 // Send for signature: emails the review link when a provider is configured, else offers copy link / mailto.
 async function sendForSignature(){if(!active||busy)return;const email=clientEmail.trim().toLowerCase();setError('');setNotice('');setSendFallback(null);if(!email){setError('Add the client’s email in the editor (Client email), then send.');return;}if(!EMAIL.test(email)){setError('Client email: enter a valid email address.');return;}setBusy(true);try{const r=await api(`/api/scopes/${active.project_id}/send`,post({version:active.version,email}));setSavedEmail(r.to);if(r.sent){setNotice(`Review link for version ${active.version} emailed to ${r.to}.`);void loadOverview();}else{setSendFallback({to:r.to,review_url:r.review_url,mailto:r.mailto});setNotice('Email delivery is not set up on this server. Copy the link or open it in your mail app below.');}}catch(e){const err=e as ApiError;if(err.data?.mailto)setSendFallback({to:String(err.data.to),review_url:String(err.data.review_url),mailto:String(err.data.mailto)});setError(err.message);}finally{setBusy(false);}}
 // Reminder for a scope still awaiting a decision: emailed when a provider is set up, else the owner's mail app opens with it filled in.
 async function remind(s:Version){if(busy)return;setBusy(true);setError('');try{const r=await api(`/api/scopes/${s.project_id}/send`,post({version:s.version,reminder:true}));if(r.sent){toast.success(`Reminder emailed to ${r.to}.`);void loadOverview();}else{location.href=r.mailto;toast.info('Your mail app opened with the reminder filled in. Email delivery is not set up on this server.');}}catch(e){const err=e as ApiError;if(err.code==='email_required'){toast.error('Add the client’s email to this project first.');if(active?.project_id!==s.project_id)void select(s);}else toast.error(err.message);}finally{setBusy(false);}}
 // Archive / restore / delete one project (owner-only, confirmed in a dialog).
 async function runProjectAction(){if(!active||!projectAction)return;const id=active.project_id;setBusy(true);setActionError('');try{if(projectAction==='delete'){await api(`/api/scopes/${id}`,{...post({confirmation:deleteText}),method:'DELETE'});setScopes(s=>s.filter(x=>x.project_id!==id));creationRequest.current=null;setActive(null);setHistory([]);setDraft(blank);setIsSample(false);setLink('');setClientEmail('');setSavedEmail('');setArchived(null);setSendFallback(null);setNotice('Project deleted.');}else{const r=await api(`/api/scopes/${id}`,{...post({archived:projectAction==='archive'}),method:'PATCH'});setArchived(r.project.archived);setScopes(s=>s.map(x=>x.project_id===id?{...x,archived:r.project.archived}:x));setNotice(projectAction==='archive'?'Project archived. Its signed record and review links are kept; restore it to keep working on it.':'Project restored.');}setProjectAction(null);setDeleteText('');}catch(e){setActionError((e as Error).message);}finally{setBusy(false);}}
 function optional<K extends 'tax_label'|'tax_pct'|'deposit_pct'|'payment_terms'|'milestones'|'fx'|'revision_bank'>(k:K,value:Scope[K]|undefined){setDraft(x=>{const next={...x};if(value===undefined||value==='')delete next[k];else next[k]=value as Scope[K];return next;});setIsSample(false);setNotice('');}
 async function saveTimeZone(tz:string){if(!active||busy)return;setBusy(true);setError('');try{const m=await api(`/api/scopes/${active.project_id}`,{...post({timezone:tz}),method:'PATCH'});setTimeZone(m.project.timezone);setNotice('Project time zone saved. Times are shown in it for you and your client.');}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
 function applyTemplate(id:string){const t=library.find(x=>x.id===id);if(!t||!newScope())return;setDraft(t.builtin?applyOwnerDefaults({...t.content},defaults as OwnerDefaults):{...t.content});setFromTemplate(t);setNotice(t.builtin?`Starter template staged${Object.keys(defaults).some(k=>(defaults as Record<string,unknown>)[k])?' with your default terms':''}. Edit it freely; set the client, price, and exact quantities before saving.`:`Your template “${t.name}” is staged. Edit it, then save the scope or update the template.`);}
 async function saveTemplate(update:boolean){const content={...draft,fee:Number.isFinite(draft.fee)?draft.fee:0,revisions:Number.isFinite(draft.revisions)?draft.revisions:0};setBusy(true);setError('');try{const r=update&&fromTemplate&&!fromTemplate.builtin?await api(`/api/templates/${fromTemplate.id}`,{...post({content,...(tplName.trim()?{name:tplName.trim()}:{})}),method:'PUT'}):await api('/api/templates',post({name:tplName.trim(),content}));setLibrary(l=>[...l.filter(x=>x.id!==r.template.id),r.template]);setFromTemplate(r.template);setTplOpen(false);setTplName('');setNotice(update?`Template “${r.template.name}” updated.`:`Saved as template “${r.template.name}”.`);}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
 async function deleteTemplate(t:Tpl){if(t.builtin||!window.confirm(`Delete your template “${t.name}”? Scopes made from it are not affected.`))return;setBusy(true);setError('');try{await api(`/api/templates/${t.id}`,{method:'DELETE',headers:{'Content-Type':'application/json'}});setLibrary(l=>l.filter(x=>x.id!==t.id));if(fromTemplate?.id===t.id)setFromTemplate(null);setNotice(`Template “${t.name}” deleted.`);}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
 async function draftWithAi(){if(!ai.enabled||busy)return;setBusy(true);setError('');try{const r=await api('/api/draft',post({brief,currency:draft.currency,quality:aiQuality}));if(!newScope())return;setDraft(r.draft);setFromTemplate(null);setNotice(`AI draft staged in the editor${r.owner_defaults?.length?' with your default terms':''}. Nothing was saved or sent: check every deliverable, the fee and the terms before saving.`);}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
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
 function goHome(){setTab('home');if(signedIn){void loadOverview();api('/api/scopes').then(d=>setScopes(d.scopes),()=>{/* keep the list we have */});}}
 const homeRef=useRef(goHome);useEffect(()=>{homeRef.current=signedIn?goHome:()=>{setTrying(false);setTab('project');window.scrollTo({top:0});};});
 const searchRef=useRef<HTMLInputElement>(null);
 const keyHandler=useRef<(e:KeyboardEvent)=>void>(()=>{});
 useEffect(()=>{keyHandler.current=(e:KeyboardEvent)=>{
  if((e.metaKey||e.ctrlKey)&&!e.altKey&&!e.shiftKey&&e.key.toLowerCase()==='s'){if(tab!=='project'||document.querySelector('[role=dialog]'))return;e.preventDefault();if(!busy&&!blockReason)void save();return;}
  if(e.metaKey||e.ctrlKey||e.altKey||document.querySelector('[role=dialog][data-state=open],[role=menu][data-state=open]'))return;
  const target=e.target as HTMLElement|null;if(target?.closest('input,textarea,select,[contenteditable="true"],[role=combobox],[role=listbox]'))return;
  if(e.key==='/'){e.preventDefault();goHome();requestAnimationFrame(()=>setTimeout(()=>searchRef.current?.focus(),0));}
  else if(e.key==='?'){e.preventDefault();setKeysOpen(true);}
  else if(e.key==='n'){e.preventDefault();newScope();}
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
 const nextActions=!active?(!signedIn&&!loading?<Link className="primary" href="/auth/sign-in?return_to=%2F">Sign in</Link>:null)
  :next.kind==='send'?<>{!archived&&(activeOv?.last_sent?<button className="primary" disabled={busy||activeOv.reminders>=3} onClick={()=>void remind(active)}><BellRing size={15}/>Send a reminder</button>:<button className="primary" disabled={busy} onClick={sendForSignature} title={mailOn?'Email the review link to the client':'Email is not configured: copy the link or use your mail app'}>Send for signature</button>)}<button className="secondary" disabled={!!active.revoked} onClick={copyReviewLink}><Copy size={15}/>Copy review link</button></>
  :next.kind==='copy_link'?<button className="primary" disabled={!!active.revoked} onClick={copyReviewLink}><Copy size={15}/>Copy review link</button>
  :next.kind==='revise'?<button className="primary" onClick={()=>{setReviseOpen(true);requestAnimationFrame(()=>toTop('step-scope'));}}>Revise scope</button>
  :next.kind==='change_order'?<><a className="primary" href={receiptUrl(active)} download><Download size={15}/>Download receipt</a><button className="secondary" disabled={busy} onClick={()=>setCoSignal(n=>n+1)}><FilePlus2 size={15}/>Record change order</button></>
  :next.kind==='restore'?<button className="primary" disabled={busy} onClick={()=>{setActionError('');setProjectAction('restore');}}>Restore project</button>
  :<a className="secondary" href="#step-approval">Go to approval</a>;
 // ---- Projects home ---------------------------------------------------------------------------
 const PRIORITY:Record<StageId,number>={changes_requested:0,change_pending:1,awaiting:2,draft:3,approved:4,archived:5};
 const cards=scopes.map(s=>{const ov=ovById.get(s.project_id);const input={saved:true,status:s.status,revoked:s.revoked,archived:s.archived,pendingChanges:ov?.pending_changes??0,client:s.content.client};return {s,ov,stage:stageOf(input),steps:trackerSteps(input),next:nextStep(input)};});
 const filtered=cards.filter(c=>(statusFilter==='archived'?c.stage==='archived':c.stage!=='archived'&&(statusFilter==='all'||c.stage===statusFilter))&&[c.s.content.title,c.s.content.client].some(x=>x.toLowerCase().includes(query.toLowerCase()))).sort((x,y)=>PRIORITY[x.stage]-PRIORITY[y.stage]);
 const count=(st:StageId)=>cards.filter(c=>c.stage===st).length;
 const urgent=cards.filter(c=>c.stage!=='archived').sort((x,y)=>PRIORITY[x.stage]-PRIORITY[y.stage])[0];
 const unsaved=signedIn&&!active&&!isSample&&meaningfulDraft(draft,sample,blank);
 // The draft kept with the account stays one tap away while another project is open.
 const unsavedCard=unsaved?<UnsavedCard title={draft.title} sync={draftSync} onOpen={()=>setTab('project')}/>:signedIn&&active&&keptDraft?<UnsavedCard title={keptDraft.title} sync={null} onOpen={()=>{const kept=keptDraft;if(newScope()){setDraft(kept);setNotice('Your unsaved draft is open again.');}}}/>:null;
 const ins=overview?.insights;
 // Money still owed on approved agreements (agreed total with tax, less every payment on the record), per currency.
 const owed=(overview?.projects??[]).filter(p=>(p.balance??0)>0&&cards.some(c=>c.s.project_id===p.project_id&&c.stage!=='archived'));
 const dueByCurrency=owed.reduce<Record<string,number>>((m,p)=>({...m,[p.currency]:Math.round(((m[p.currency]??0)+(p.balance??0))*100)/100}),{}),dueCount=owed.length;
 /** How long an awaiting scope has waited since it was saved or last emailed, and whether a reminder is due. */
 const waiting=(c:typeof cards[number])=>{const age=daysAgo(c.ov?.last_sent??c.s.created),reminders=c.ov?.reminders??0;return {age,reminders,due:c.stage==='awaiting'&&!c.s.revoked&&age.days>=STALE_DAYS&&reminders<3};};
 function cardAction(c:typeof cards[number]){
  const k=c.next.kind;
  if(k==='send'&&waiting(c).due)return <button className="secondary" disabled={busy} onClick={()=>void remind(c.s)}><BellRing size={15}/>Send a reminder</button>;
  if((k==='send'||k==='copy_link')&&!c.s.revoked)return <button className="secondary" onClick={()=>void copy(location.origin+'/review/'+c.s.token,'Review link')}><Copy size={15}/>Copy review link</button>;
  if(k==='revise')return <button className="secondary" disabled={busy} onClick={()=>void select(c.s,'revise')}>Revise scope</button>;
  if(k==='change_order')return <button className="secondary" disabled={busy} onClick={()=>void select(c.s,'change_order')}><FilePlus2 size={15}/>Record change order</button>;
  return <button className="secondary" disabled={busy} onClick={()=>void select(c.s)}>Open project</button>;
 }
 const amountLine=(c:typeof cards[number])=>{const o=c.ov,cur=c.s.content.currency;if(!o)return <span><b>Quoted</b> {money(c.s.content)}</span>;
  if(o.agreed_fee===null)return <><span><b>Quoted</b> {formatMoney(o.quoted_fee,cur)}</span><span className="quiet">Not approved yet</span></>;
  return <><span><b>Approved</b> {formatMoney(o.agreed_fee,cur)}{o.agreed_total!==null&&o.agreed_total!==o.agreed_fee&&<span className="quiet"> · {formatMoney(o.agreed_total,cur)} with tax</span>}</span>{o.pending_changes>0&&<span className="warn-ink"><b>{o.pending_changes} change order{o.pending_changes>1?'s':''} pending</b>{o.pending_value?` · ${o.pending_value>0?'+':''}${formatMoney(o.pending_value,cur)}`:''}</span>}{o.balance===0?<span className="ok-ink"><b>Paid in full</b> · {formatMoney(o.paid,cur)}</span>:o.paid>0?<span><b>Received</b> {formatMoney(o.paid,cur)} · <b>Due</b> {formatMoney(o.balance??0,cur)}</span>:o.deposit_due!==null?<span><b>Deposit due</b> {formatMoney(o.deposit_due,cur)}</span>:o.balance!==null&&<span><b>Due</b> {formatMoney(o.balance,cur)}</span>}</>;};
  return {query,setQuery,statusFilter,setStatusFilter,linkAction,setLinkAction,shownLink,draft,setDraft,scopes,history,active,signedIn,busy,loading,error,notice,setNotice,tab,setTab,link,importOpen,setImportOpen,importText,setImportText,importError,setImportError,isSample,setIsSample,undo,setUndo,supersede,setSupersede,clientEmail,setClientEmail,savedEmail,archived,sendFallback,setSendFallback,projectAction,setProjectAction,shownAction,deleteText,setDeleteText,actionError,setActionError,opening,reviseOpen,setReviseOpen,ledgerView,coSignal,ledgerReload,setLedgerReload,insightsOpen,setInsightsOpen,onLedgerView,library,fromTemplate,tplName,setTplName,tplOpen,setTplOpen,ai,trust,setTrust,cosigns,linkExpiresAt,otpChannels,aiQuality,setAiQuality,brief,setBrief,timeZone,trying,setTrying,draftSync,overview,loadOverview,field,undoReplace,setItems,tryEditor,newScope,duplicateDraft,select,save,startFromAgreement,copy,copyReviewLink,importDraft,manageLink,exportProject,saveEmail,remind,runProjectAction,optional,saveTimeZone,applyTemplate,saveTemplate,deleteTemplate,draftWithAi,changed,problems,fees,blockReason,keysOpen,setKeysOpen,goHome,searchRef,hasMoneyTerms,moneySummary,preview,activeOv,pendingCos,stage,steps,next,receiptUrl,calloutCopies,nextActions,cards,filtered,count,urgent,unsavedCard,ins,dueByCurrency,dueCount,waiting,cardAction,amountLine};
}
export type Ws=ReturnType<typeof useWorkspace>;
