'use client';
import Link from 'next/link';
import {useEffect,useState} from 'react';
import {Header,api} from '../ui';
import {ContactLink} from '../contact';
import {NextStep} from '../workflow';
import {Dialog,DialogContent,DialogTitle,DialogDescription} from '@/components/ui/dialog';
type Summary={projects:number;versions:number};
export default function Account(){
 const [summary,setSummary]=useState<Summary|null>(null),[signedOut,setSignedOut]=useState(false),[checking,setChecking]=useState(true);
 const [message,setMessage]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 const [confirmOpen,setConfirmOpen]=useState(false),[confirmation,setConfirmation]=useState('');
 // Retention and wording (account settings).
 type Settings={context_retention_days:number|null;email_subject:string;email_body:string;default_exclusions:string;default_terms:string};
 const [settings,setSettings]=useState<Settings|null>(null),[serverDefault,setServerDefault]=useState<number|null>(null),[settingsNote,setSettingsNote]=useState('');
 useEffect(()=>{api('/api/me').then(async({signedIn})=>{if(!signedIn){setSignedOut(true);return;}setSummary(await api('/api/account'));try{const st=await api('/api/settings');setSettings(st.settings);setServerDefault(st.server_default_retention_days);}catch{/* settings unavailable */}}).catch(e=>setError(e.message)).finally(()=>setChecking(false));},[]);
 // BUG-9: say why the controls are unavailable, right next to them.
 const gate=checking?'Checking your sign-in…':signedOut?'Sign in to use this control.':null;
 async function removeData(){
  if(confirmation!=='DELETE'||busy)return;
  setBusy(true);setError('');
  try{await api('/api/account',{method:'DELETE',headers:{'Content-Type':'application/json'},body:JSON.stringify({confirmation})});setSummary({projects:0,versions:0});setConfirmation('');setConfirmOpen(false);setMessage('Your Scopeflow data has been deleted. All previous review links and API tokens are now invalid.');}
  catch(e){setError((e as Error).message);}finally{setBusy(false);}
 }
 async function saveSettings(){if(!settings||busy)return;setBusy(true);setError('');setSettingsNote('');try{const r=await api('/api/settings',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(settings)});setSettings(r.settings);const n=r.redacted.versions+r.redacted.entries;setSettingsNote('Settings saved.'+(n?` Network details on ${n} older ${n===1?'record were':'records were'} redacted.`:''));}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
 const set=<K extends keyof Settings>(k:K,v:Settings[K])=>setSettings(x=>x?{...x,[k]:v}:x);
 return <><Header/><main id="main" className="review-shell policy"><section className="editor">
  <p className="eyebrow">ACCOUNT · DATA CONTROLS</p><h1>Keep control of <em>your work.</em></h1>
  {signedOut?<NextStep title="Sign in to manage your data" actions={<Link className="primary" href="/auth/sign-in?return_to=%2Faccount">Sign in</Link>}>Retention, your email wording and deletion are per account.</NextStep>:<NextStep title="Set your wording once" actions={<Link className="secondary" href="/">Back to projects</Link>}>The email wording and default terms below are used for every new scope. Export a project from its page before deleting anything.</NextStep>}
  <p>Export any project and its complete version history from the workspace. The export includes private scope content and review links; store it securely.</p>
  <p className="fine">Before deleting your data, tell your clients and send them their copies: deletion removes every approval record and review link.</p>
  <p>Review links can be revoked or replaced from the selected project. Revoking a link blocks access and new decisions. Previous decisions remain in your private history.</p>
  {settings&&<><h2>Client data retention</h2><p>When a client decides, Scopeflow records the network address and browser it came from. Choose how long to keep them; afterwards they are replaced with “redacted”. The signed decision, its fingerprint and signature are never changed.</p><label>Keep client network details<select value={settings.context_retention_days??''} onChange={e=>set('context_retention_days',e.target.value===''?null:Number(e.target.value))}><option value="">{serverDefault?`Server default (${serverDefault} days)`:'Until I delete the project'}</option>{[30,90,180,365,730].map(d=><option key={d} value={d}>{d} days</option>)}</select></label>
  <h2>Your wording</h2><p className="fine">Used instead of Scopeflow’s defaults. In the email you can use {'{client}'}, {'{title}'}, {'{version}'} and {'{link}'}; the body must include {'{link}'}.</p><label>“Send for signature” subject<input maxLength={200} placeholder="Please review and approve: {title} (version {version})" value={settings.email_subject} onChange={e=>set('email_subject',e.target.value)}/></label><label>“Send for signature” message<textarea rows={5} maxLength={4000} placeholder={'Hi {client},\n\nThe scope for {title} is ready: {link}'} value={settings.email_body} onChange={e=>set('email_body',e.target.value)}/></label><label>Default “Outside this scope” text for new drafts<textarea rows={2} maxLength={3000} value={settings.default_exclusions} onChange={e=>set('default_exclusions',e.target.value)}/></label><label>Default working terms for new drafts<textarea rows={3} maxLength={3000} value={settings.default_terms} onChange={e=>set('default_terms',e.target.value)}/></label><button className="primary section-gap" disabled={busy} onClick={saveSettings}>{busy?'Saving…':'Save settings'}</button>{settingsNote&&<p role="status">{settingsNote}</p>}</>}
  <h2>API access</h2><p>Tokens expire after 30 days. Revoking your token disconnects every integration using it.</p>
  <button className="secondary section-gap" disabled={busy||!summary} aria-describedby={gate?'gate-key':undefined} onClick={async()=>{setBusy(true);setError('');try{await api('/api/key',{method:'DELETE'});setMessage('API token revoked.');}catch(e){setError((e as Error).message);}finally{setBusy(false);}}}>Revoke API token</button>{gate&&<p id="gate-key" className="fine">{gate} {signedOut&&<Link className="help-link" href="/auth/sign-in?return_to=%2Faccount">Sign in</Link>}</p>}
  <h2>Delete your Scopeflow data</h2>
  <p>Permanently remove all your projects, versions, reviewer decisions, change orders and other ledger records, review links, API tokens, and associated activity limits. Export anything you want to keep first.</p>
  {summary&&<p className="quiet">{summary.projects} {summary.projects===1?'project':'projects'} · {summary.versions} saved {summary.versions===1?'version':'versions'}</p>}
  <p>This deletes your data in Scopeflow. Your login account stays active, and you can start fresh here afterward. Copies you have exported or shared elsewhere are outside Scopeflow.</p>
  <button className="secondary danger section-gap" disabled={busy||!summary} aria-describedby={gate?'gate-delete':undefined} onClick={()=>{setConfirmation('');setError('');setConfirmOpen(true);}}>Delete all Scopeflow data</button>{gate&&<p id="gate-delete" className="fine">{gate} {signedOut&&<Link className="help-link" href="/auth/sign-in?return_to=%2Faccount">Sign in</Link>}</p>}
  {message&&<p role="status">{message}</p>}{error&&!confirmOpen&&<p className="error" role="alert">{error}</p>}
  <h2>Corrections and help</h2><p>For a correction to a recorded reviewer name or help with access, contact Scopeflow support through <ContactLink/>.</p>
 </section></main>
 <Dialog open={confirmOpen} onOpenChange={open=>{if(!busy){setConfirmOpen(open);setConfirmation('');}}}>
  <DialogContent showCloseButton={!busy} onEscapeKeyDown={e=>{if(busy)e.preventDefault();}} onPointerDownOutside={e=>{if(busy)e.preventDefault();}}>
   <DialogTitle>Delete all your Scopeflow data?</DialogTitle>
   <DialogDescription>This permanently deletes {summary?.projects??0} {summary?.projects===1?'project':'projects'} and {summary?.versions??0} {summary?.versions===1?'version':'versions'}, including reviewer names, comments, decisions, change orders and ledger records. Every review link and API token will stop working. You cannot undo this.</DialogDescription>
   <p className="fine">Export your projects first. Your login account will remain active. Provider backups and logs follow the retention practices described in our <a href="/privacy">privacy policy</a>.</p>
   <label>Type DELETE to confirm<input value={confirmation} onChange={e=>setConfirmation(e.target.value)} autoComplete="off" spellCheck={false} disabled={busy}/></label>
   {error&&<p className="error" role="alert">{error}</p>}
   <div className="actions"><button className="secondary" disabled={busy} onClick={()=>setConfirmOpen(false)}>Cancel</button><button className="primary danger" disabled={confirmation!=='DELETE'||busy} onClick={removeData}>{busy?'Deleting…':'Permanently delete my data'}</button></div>
  </DialogContent>
 </Dialog></>;
}
