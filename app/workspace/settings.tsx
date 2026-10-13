'use client';
import {Download} from 'lucide-react';
import TimezoneSelect from '../components/slots/timezone-select';
import {RetentionSettings} from '../retention-settings';
import {InboundPanel} from '../inbound-panel';
import ContactChange from '../components/slots/contact-change';
import CosignerEditor from '../components/slots/cosigner-editor';
import {NotifyToggle} from './client-notices';
import type {Ws} from './state';

export function settingsStep(w:Ws){const {accountZone,cosignLinks,reloadProject,savedEmail,active,archived,busy,duplicateDraft,exportProject,history,saveTimeZone,setActionError,setDeleteText,setProjectAction,setTrust,timeZone,trust}=w;
  return (active&&<section id="project-settings" className="editor flow-step" aria-labelledby="h-settings">
      <div className="step-head"><h3 id="h-settings">Project settings</h3></div>
     <div className="section-gap"><TimezoneSelect id="project-tz" label="Project time zone" value={timeZone??'UTC'} accountZone={accountZone} disabled={busy} onChange={z=>{if(z!==timeZone)void saveTimeZone(z);}}/><p className="fine">Every time is shown in this zone, for you and your client.</p></div>
     {/* WS-09 mounts (WS-02 / WS-06 slots): locked contact change with notice, countersigner roles, client notifications. They render nothing until those workstreams land. */}
     {trust&&<ContactChange projectId={active.project_id} clientEmail={trust.client_email||savedEmail} clientPhone={trust.client_phone??''} locked={!!(trust as {contact_locked?:boolean}).contact_locked} onChanged={reloadProject}/>}
     {trust&&<CosignerEditor projectId={active.project_id} cosigners={trust.cosigners??[]} frozen={!!(trust as {roles_frozen?:boolean}).roles_frozen} links={cosignLinks} onChanged={reloadProject}/>}
     <NotifyToggle projectId={active.project_id} disabled={busy||!!archived}/>
      <div className="action-group section-gap"><span className="action-label">Project</span><button className="secondary" disabled={busy} onClick={duplicateDraft}>Reuse as new draft</button><button className="secondary" onClick={exportProject}><Download size={15}/>Export project JSON</button>{!archived&&<button className="secondary" disabled={busy} onClick={()=>{setActionError('');setProjectAction('archive');}}>Archive project</button>}{history.every(v=>v.status==='pending')&&!trust?.legal_hold&&<button className="secondary danger" disabled={busy} onClick={()=>{setActionError('');setDeleteText('');setProjectAction('delete');}}>Delete project</button>}</div>
      {trust&&<RetentionSettings projectId={active.project_id} settings={{retention_days:trust.retention_days??null,legal_hold:!!trust.legal_hold,legal_hold_reason:trust.legal_hold_reason??'',legal_hold_set:trust.legal_hold_set??null}} timeZone={timeZone} onChange={p=>setTrust(t=>t&&({...t,...p}))}/>}
      <InboundPanel projectId={active.project_id} timeZone={timeZone}/>
      {archived&&<p className="fine">This project is archived: it is hidden from your project list and cannot get new versions or ledger entries until you restore it. Its signed record and review links are unchanged.</p>}{!history.every(v=>v.status==='pending')&&<p className="fine">This project has a client decision on record, so it can be archived but not deleted. Deleting your whole account (Settings) removes everything.</p>}
     </section>
  );
}
