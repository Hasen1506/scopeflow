'use client';
import Link from 'next/link';
import {useEffect,useState} from 'react';
import {Header,api} from '../ui';
import {ContactLink} from '../contact';
import {NextStep} from '../workflow';
import {gstinState, stateCodes, stateName, validGstin} from '@/lib/gst';
import {currencyList} from '@/lib/currency';
import type {Profile} from '@/lib/profile';
import {BrandSettings} from '@/app/brand-settings';
import {Dialog,DialogContent,DialogTitle,DialogDescription} from '@/components/ui/dialog';
import {forgetDrafts} from '@/lib/editor';
type Summary={projects:number;versions:number};
export default function Account(){
 const [summary,setSummary]=useState<Summary|null>(null),[signedOut,setSignedOut]=useState(false),[checking,setChecking]=useState(true);
 const [message,setMessage]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 const [confirmOpen,setConfirmOpen]=useState(false),[confirmation,setConfirmation]=useState('');
 // Retention and wording (account settings).
 type Settings={context_retention_days:number|null;email_subject:string;email_body:string;default_exclusions:string;default_terms:string;draft_expiry_days:number|null};
 const [settings,setSettings]=useState<Settings|null>(null),[serverDefault,setServerDefault]=useState<number|null>(null),[settingsNote,setSettingsNote]=useState('');
 // Business details: invoice seller details, new-draft defaults, automatic reminders.
 const [profile,setProfile]=useState<Profile|null>(null),[mailOn,setMailOn]=useState(false),[profileNote,setProfileNote]=useState('');
 useEffect(()=>{api('/api/me').then(async({signedIn})=>{if(!signedIn){setSignedOut(true);return;}setSummary(await api('/api/account'));try{const st=await api('/api/settings');setSettings(st.settings);setServerDefault(st.server_default_retention_days);}catch{/* settings unavailable */}try{const pr=await api('/api/profile');setProfile(pr.profile);setMailOn(!!pr.mail_configured);}catch{/* profile unavailable */}}).catch(e=>setError(e.message)).finally(()=>setChecking(false));},[]);
 async function saveProfile(){if(!profile||busy)return;setBusy(true);setError('');setProfileNote('');try{const r=await api('/api/profile',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(profile)});setProfile(r.profile);setProfileNote('Business details saved. New scopes start with these defaults.');}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
 const setP=<K extends keyof Profile>(k:K,v:Profile[K])=>setProfile(x=>x?{...x,[k]:v}:x);
 const pctValue=(v:number|null)=>v===null?'':String(v),pctInput=(raw:string)=>raw===''?null:Math.min(100,Math.max(0,Number(raw)));
 // BUG-9: say why the controls are unavailable, right next to them.
 const gate=checking?'Checking your sign-in…':signedOut?'Sign in to use this control.':null;
 async function removeData(){
  if(confirmation!=='DELETE'||busy)return;
  setBusy(true);setError('');
  try{await api('/api/account',{method:'DELETE',headers:{'Content-Type':'application/json'},body:JSON.stringify({confirmation})});forgetDrafts();setSummary({projects:0,versions:0});setConfirmation('');setConfirmOpen(false);setMessage('Your Scopeflow data has been deleted. All previous review links and API tokens are now invalid.');}
  catch(e){setError((e as Error).message);}finally{setBusy(false);}
 }
 async function saveSettings(){if(!settings||busy)return;setBusy(true);setError('');setSettingsNote('');try{const r=await api('/api/settings',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(settings)});setSettings(r.settings);const n=r.redacted.versions+r.redacted.entries,x=r.expired_drafts??0;setSettingsNote('Settings saved.'+(n?` Network details on ${n} older ${n===1?'record were':'records were'} redacted.`:'')+(x?` ${x} archived draft${x===1?' was':'s were'} deleted.`:''));}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
 const set=<K extends keyof Settings>(k:K,v:Settings[K])=>setSettings(x=>x?{...x,[k]:v}:x);
 return <><Header/><main id="main" className="review-shell policy"><section className="editor">
  <p className="eyebrow">ACCOUNT · DATA CONTROLS</p><h1>Keep control of <em>your work.</em></h1>
  {signedOut?<NextStep title="Sign in to manage your data" actions={<Link className="primary" href="/auth/sign-in?return_to=%2Faccount">Sign in</Link>}>Retention, your email wording and deletion are per account.</NextStep>:<NextStep title="Set your details once" actions={<Link className="secondary" href="/">Back to projects</Link>}>Your email wording, business details for invoices and the defaults below apply to every new scope.</NextStep>}
  {settings&&<section aria-labelledby="h-wording"><h2 id="h-wording">Your wording</h2><p className="fine">Used instead of Scopeflow’s defaults. In the email you can use {'{client}'}, {'{title}'}, {'{version}'} and {'{link}'}; the body must include {'{link}'}.</p><label>“Send for signature” subject<input maxLength={200} placeholder="Please review and approve: {title} (version {version})" value={settings.email_subject} onChange={e=>set('email_subject',e.target.value)}/></label><label>“Send for signature” message<textarea rows={5} maxLength={4000} placeholder={'Hi {client},\n\nThe scope for {title} is ready: {link}'} value={settings.email_body} onChange={e=>set('email_body',e.target.value)}/></label><label>Default “Outside this scope” text for new drafts<textarea rows={2} maxLength={3000} value={settings.default_exclusions} onChange={e=>set('default_exclusions',e.target.value)}/></label><label>Default working terms for new drafts<textarea rows={3} maxLength={3000} value={settings.default_terms} onChange={e=>set('default_terms',e.target.value)}/></label>
  <h2 id="h-retention">Client data retention</h2><p>When a client decides, Scopeflow records the network address and browser it came from. Choose how long to keep them; afterwards they are replaced with “redacted”. The signed decision, its fingerprint and signature are never changed.</p><label>Keep client network details<select value={settings.context_retention_days??''} onChange={e=>set('context_retention_days',e.target.value===''?null:Number(e.target.value))}><option value="">{serverDefault?`Server default (${serverDefault} days)`:'Until I delete the project'}</option>{[30,90,180,365,730].map(d=><option key={d} value={d}>{d} days</option>)}</select></label><p className="fine">A project can keep its own period, or be put on legal hold so nothing on it is redacted or deleted: open the project, then <strong>Project settings → Retention</strong>.</p>
  <label>Delete archived drafts<select value={settings.draft_expiry_days??''} onChange={e=>set('draft_expiry_days',e.target.value===''?null:Number(e.target.value))}><option value="">Never: keep them until I delete them</option>{[30,90,180,365].map(d=><option key={d} value={d}>{d} days after archiving</option>)}</select></label><p className="fine">Only archived projects that never got a client decision or ledger entry are deleted, and never one on legal hold. Anything a client signed is kept.</p>
  <div className="actions section-gap"><button className="primary" disabled={busy} onClick={saveSettings}>{busy?'Saving…':'Save settings'}</button>{settingsNote&&<p role="status" className="fine flush">{settingsNote}</p>}</div></section>}
  {profile&&<section aria-labelledby="h-business"><h2 id="h-business">Business details</h2><p className="fine">Printed as the seller on your invoices. Only you and the clients you send invoices to see them.</p>
   <div className="two-col"><label>Business or trading name<input maxLength={120} placeholder="e.g. Ada Studio" value={profile.business_name} onChange={e=>setP('business_name',e.target.value)}/></label><label>Tax ID <span className="quiet">· optional, e.g. GSTIN</span><input maxLength={40} value={profile.tax_id} onChange={e=>setP('tax_id',e.target.value)}/></label></div>
   <label>Address <span className="quiet">· optional</span><textarea rows={2} maxLength={500} value={profile.business_address} onChange={e=>setP('business_address',e.target.value)}/></label>
   <label>How clients pay you <span className="quiet">· printed on invoices, e.g. bank account or UPI ID</span><textarea rows={2} maxLength={500} value={profile.payment_details} onChange={e=>setP('payment_details',e.target.value)}/></label>
   <details className="disclosure" open={!!(profile.gst_state||profile.sac_code||profile.lut_arn)||undefined}><summary>GST tax invoices (India) <span className="quiet">· {profile.gst_state?`registered in ${stateName(profile.gst_state)}`:'optional'}</span></summary>
    <p className="fine">With your GSTIN as the tax ID and a tax named GST on the scope, invoices are issued as tax invoices: SAC, place of supply and CGST + SGST within your state or IGST across states.{profile.tax_id&&gstinState(profile.tax_id)&&!validGstin(profile.tax_id)?' Check your GSTIN: its last character does not match the rest.':''}</p>
    <div className="three-col"><label>Registered in<select value={profile.gst_state||gstinState(profile.tax_id)} onChange={e=>setP('gst_state',e.target.value)}><option value="">Not registered</option>{stateCodes.filter(c=>c!=='96').map(c=><option key={c} value={c}>{c} · {stateName(c)}</option>)}</select></label><label>SAC code <span className="quiet">· e.g. 998391</span><input maxLength={8} inputMode="numeric" value={profile.sac_code} onChange={e=>setP('sac_code',e.target.value)}/></label><label>Export LUT ARN <span className="quiet">· optional</span><input maxLength={40} value={profile.lut_arn} onChange={e=>setP('lut_arn',e.target.value)}/></label></div>
   </details>
   <label>Invoice number prefix<input maxLength={12} placeholder="INV-" value={profile.invoice_prefix} onChange={e=>setP('invoice_prefix',e.target.value)}/><span className="fine block">Invoices are numbered in order with no gaps: {(profile.invoice_prefix||'INV-')}0001, {(profile.invoice_prefix||'INV-')}0002…</span></label>
   <h2 id="h-defaults">Defaults for new scopes</h2><p className="fine">Pre-filled when you start a new scope; you can change them on each scope. Templates and existing scopes are not changed.</p>
   <div className="two-col"><label>Currency<select value={profile.default_currency} onChange={e=>setP('default_currency',e.target.value as Profile['default_currency'])}><option value="">Scopeflow default (USD)</option>{currencyList.map(c=><option key={c.code} value={c.code}>{c.code} · {c.name}</option>)}</select></label><label>Deposit on signature (%)<input type="number" min={0} max={100} step="any" inputMode="decimal" value={pctValue(profile.default_deposit_pct)} onChange={e=>setP('default_deposit_pct',pctInput(e.target.value))}/></label></div>
   <div className="two-col"><label>Tax name<input maxLength={24} placeholder="e.g. GST" value={profile.default_tax_label} onChange={e=>setP('default_tax_label',e.target.value)}/></label><label>Tax rate (%)<input type="number" min={0} max={100} step="any" inputMode="decimal" value={pctValue(profile.default_tax_pct)} onChange={e=>setP('default_tax_pct',pctInput(e.target.value))}/></label></div>
   <label>Payment terms<input maxLength={500} placeholder="e.g. Balance within 15 days of delivery" value={profile.default_payment_terms} onChange={e=>setP('default_payment_terms',e.target.value)}/></label>
   <h2 id="h-reminders">Automatic reminders</h2><p className="fine">Scopeflow can email your client a short reminder when a scope has waited this long without a decision. It uses the same rules as the Send a reminder button: at most one email a day and three reminders per version. Only projects with a client email get them.{!mailOn&&' Email delivery is not set up on this server yet, so nothing is sent until it is.'}</p>
   <label>Remind clients automatically<select value={profile.auto_remind_days??''} onChange={e=>setP('auto_remind_days',e.target.value===''?null:Number(e.target.value) as Profile['auto_remind_days'])}><option value="">Off: I send reminders myself</option>{[3,5,7,14].map(d=><option key={d} value={d}>After {d} days without a decision</option>)}</select></label>
   <div className="actions section-gap"><button className="primary" disabled={busy} onClick={saveProfile}>{busy?'Saving…':'Save business details'}</button>{profileNote&&<p role="status" className="fine flush">{profileNote}</p>}</div></section>}
  {profile&&<BrandSettings/>}
  <h2>Your records</h2>
  <p>Export any project with every version and ledger entry from its page (<strong>Project settings → Export project JSON</strong>). The export includes private scope content and review links; store it securely.</p>
  <p>Review links are revoked or replaced from the project’s <strong>Approval</strong> step. Revoking blocks access and new decisions; earlier decisions stay in your private history.</p>
  <h2>API access</h2><p>Tokens expire after 30 days. Revoking your token disconnects every integration using it. Create one from <Link className="help-link" href="/connect">Connect</Link>.</p>
  <button className="secondary section-gap" disabled={busy||!summary} aria-describedby={gate?'gate-key':undefined} onClick={async()=>{setBusy(true);setError('');try{await api('/api/key',{method:'DELETE'});setMessage('API token revoked.');}catch(e){setError((e as Error).message);}finally{setBusy(false);}}}>Revoke API token</button>{gate&&<p id="gate-key" className="fine">{gate} {signedOut&&<Link className="help-link" href="/auth/sign-in?return_to=%2Faccount">Sign in</Link>}</p>}
  <div className="danger-zone section-gap"><h2>Delete your Scopeflow data</h2>
  <p>Permanently remove all your projects, versions, reviewer decisions, change orders and other ledger records, review links, API tokens, and associated activity limits. Export anything you want to keep first, and tell your clients and send them their copies: deletion removes every approval record and review link.</p>
  {summary&&<p className="quiet">{summary.projects} {summary.projects===1?'project':'projects'} · {summary.versions} saved {summary.versions===1?'version':'versions'}</p>}
  <p>Your login account stays active, and you can start fresh here afterward. Copies you have exported or shared elsewhere are outside Scopeflow.</p>
  <button className="secondary danger section-gap" disabled={busy||!summary} aria-describedby={gate?'gate-delete':undefined} onClick={()=>{setConfirmation('');setError('');setConfirmOpen(true);}}>Delete all Scopeflow data</button>{gate&&<p id="gate-delete" className="fine">{gate} {signedOut&&<Link className="help-link" href="/auth/sign-in?return_to=%2Faccount">Sign in</Link>}</p>}
  </div>
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
