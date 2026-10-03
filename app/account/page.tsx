'use client';
import Link from 'next/link';
import {useEffect,useState} from 'react';
import {Header,api} from '../ui';
import {Dialog,DialogContent,DialogTitle,DialogDescription} from '@/components/ui/dialog';
type Summary={projects:number;versions:number};
export default function Account(){
 const [summary,setSummary]=useState<Summary|null>(null),[signedOut,setSignedOut]=useState(false);
 const [message,setMessage]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 const [confirmOpen,setConfirmOpen]=useState(false),[confirmation,setConfirmation]=useState('');
 useEffect(()=>{api('/api/me').then(async({signedIn})=>{if(!signedIn){setSignedOut(true);return;}setSummary(await api('/api/account'));}).catch(e=>setError(e.message));},[]);
 async function removeData(){
  if(confirmation!=='DELETE'||busy)return;
  setBusy(true);setError('');
  try{await api('/api/account',{method:'DELETE',headers:{'Content-Type':'application/json'},body:JSON.stringify({confirmation})});setSummary({projects:0,versions:0});setConfirmation('');setConfirmOpen(false);setMessage('Your Scopeflow data has been deleted. All previous review links and API tokens are now invalid.');}
  catch(e){setError((e as Error).message);}finally{setBusy(false);}
 }
 return <><Header/><main className="review-shell policy"><section className="editor">
  <p className="eyebrow">YOUR DATA</p><h1>Keep control of your work.</h1>
  <p>Export any project and its complete version history from the workspace. The export includes private scope content and review links; store it securely.</p>
  <p>Review links can be revoked or replaced from the selected project. Revoking a link blocks access and new decisions. Previous decisions remain in your private history.</p>
  {signedOut&&<p><Link className="primary" href="/auth/sign-in?return_to=%2Faccount">Sign in to manage your data</Link></p>}
  <h2>API access</h2><p>Tokens expire after 30 days. Revoking your token disconnects every integration using it.</p>
  <button className="secondary section-gap" disabled={busy||!summary} onClick={async()=>{setBusy(true);setError('');try{await api('/api/key',{method:'DELETE'});setMessage('API token revoked.');}catch(e){setError((e as Error).message);}finally{setBusy(false);}}}>Revoke API token</button>
  <h2>Delete your Scopeflow data</h2>
  <p>Permanently remove all your projects, versions, reviewer decisions, change orders and other ledger records, review links, API tokens, and associated activity limits. Export anything you want to keep first.</p>
  {summary&&<p className="quiet">{summary.projects} {summary.projects===1?'project':'projects'} · {summary.versions} saved {summary.versions===1?'version':'versions'}</p>}
  <p>This deletes your data in Scopeflow. Your login account stays active, and you can start fresh here afterward. Copies you have exported or shared elsewhere are outside Scopeflow.</p>
  <button className="secondary danger section-gap" disabled={busy||!summary} onClick={()=>{setConfirmation('');setError('');setConfirmOpen(true);}}>Delete all Scopeflow data</button>
  {message&&<p role="status">{message}</p>}{error&&!confirmOpen&&<p className="error" role="alert">{error}</p>}
  <h2>Corrections and help</h2><p>For a correction to a recorded reviewer name or help with access, contact <a href="mailto:hasenhamesh15@gmail.com">hasenhamesh15@gmail.com</a>.</p>
  <a className="secondary section-gap" href="/">Back to workspace</a>
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
