'use client';
import {ArrowUpRight,Copy,RefreshCw,BellRing} from 'lucide-react';
import {label} from '@/lib/scope';
import {formatInZone,daysAgo} from '@/lib/time';
import {ScopeCheck} from '../scope-check';
import {TrustSettings} from '../trust-settings';
import WhatsAppShare from '../components/slots/whatsapp-share';
import {revokedNote,decidedStatus} from '@/lib/review-link-copy';
import type {Ws} from './state';
import {stepState} from './step-state';

export function approvalStep(w:Ws){const {refreshDecision,active,activeOv,ai,archived,busy,calloutCopies,copy,copyReviewLink,cosigns,history,link,linkExpiresAt,next,otpChannels,receiptUrl,remind,savedEmail,sendFallback,setLinkAction,setReviseOpen,setTrust,timeZone,trust}=w;
  // Visual #16: the current version's review link stays visible (with Open and Copy) after the editor session, not only right after saving or copying.
  const reviewLink=link||(active&&!active.revoked&&typeof location!=='undefined'?location.origin+'/review/'+active.token:'');
  return (active&&<section id="step-approval" className="editor flow-step" data-state={stepState(w,'approval')} aria-labelledby="h-approval">
      <div className="step-head"><span className="step-num" aria-hidden="true">2</span><h3 id="h-approval">Approval</h3></div>
      <div className="small-title"><h4 className="h-sub">Saved version {active.version}</h4><span className={'tag status-'+active.status}>{label(active.status)}</span>{archived&&<span className="tag status-archived">Archived</span>}</div>
      {active.signer&&active.decided&&<p className="decision-line">{active.status==='approved'?'Approved':'Changes requested'} by {active.signer} · {formatInZone(active.decided,timeZone)}</p>}{active.comment&&<p className="line-list quote">{active.comment}</p>}
      {active.status==='approved'&&<p className="section-gap"><a className="secondary" href={`/api/scopes/${active.project_id}/certificate?version=${active.version}`}>Download approval certificate</a></p>}
      <div className="actions section-gap">{!calloutCopies&&<button className="secondary" disabled={!!active.revoked} onClick={copyReviewLink}><Copy size={15}/>Copy review link</button>}{active.status==='pending'&&<button className="secondary" disabled={busy} onClick={()=>void refreshDecision()}><RefreshCw size={15}/>Refresh decision</button>}{active.status==='pending'&&!archived&&!active.revoked&&next.kind==='send'&&!activeOv?.last_sent&&daysAgo(active.created).days>=1&&<button className="secondary" disabled={busy} onClick={()=>void remind(active)}><BellRing size={15}/>Send a reminder</button>}</div>
      {active.status==='pending'&&activeOv&&<p className="fine" role="note">{activeOv.viewed?<>The review link was opened {activeOv.viewed.count===1?'once':`${activeOv.viewed.count} times`}, most recently {formatInZone(activeOv.viewed.last,timeZone)}. Your own visits while signed in are not counted.</>:'The review link has not been opened yet. Your own visits while signed in are not counted.'}</p>}
      {active.status==='pending'&&activeOv?.last_sent&&<p className="fine">Last emailed {daysAgo(activeOv.last_sent).text}{activeOv.reminders?` · ${activeOv.reminders} reminder${activeOv.reminders>1?'s':''} sent${activeOv.reminders>=3?' (the most Scopeflow sends for one version)':''}`:''}. Reminders go at most once a day.</p>}
      {reviewLink&&<div className="muted-box"><label>Review link<input readOnly value={reviewLink} onFocus={e=>e.target.select()}/></label><div className="actions"><button className="secondary" onClick={()=>copy(reviewLink)}><Copy size={16}/>Copy link</button><a className="secondary" href={reviewLink} target="_blank" rel="noreferrer">Open review <ArrowUpRight size={16}/></a><WhatsAppShare kind="scope" values={{client:active.content.client,title:active.content.title,link:reviewLink}} phone={trust?.client_phone||null} projectId={active.project_id}/></div><p className="consequence">Anyone with this link can read this version and submit its decision. Share only with the intended reviewer.</p></div>}
      {sendFallback&&<div className="send-box" role="status"><p className="fine">Send this review link to {sendFallback.to}:</p><label>Review link<input readOnly value={sendFallback.review_url} onFocus={e=>e.target.select()}/></label><div className="actions"><button className="secondary" onClick={()=>copy(sendFallback.review_url)}><Copy size={16}/>Copy link</button><a className="secondary" href={sendFallback.mailto}>Open in mail app</a></div></div>}
     {trust&&<TrustSettings projectId={active.project_id} settings={{...trust,client_email:savedEmail}} channels={otpChannels} pending={active.status==='pending'} expires={linkExpiresAt} cosigns={cosigns} approved={active.status==='approved'} timeZone={timeZone} onChange={p=>setTrust(t=>({...t,...p}))}/>}
      <div className="action-group section-gap"><span className="action-label">Link</span><button className="secondary" disabled={busy} onClick={()=>setLinkAction('rotate')}>Replace review link</button><button className="secondary" disabled={busy||!!active.revoked} onClick={()=>setLinkAction('revoke')}>Revoke review link</button></div>
      {!!active.revoked&&<p className="fine">{revokedNote(decidedStatus(active.status))}</p>}
      {active.status!=='approved'&&!archived&&<ScopeCheck projectId={active.project_id} busy={busy} ai={ai} onRevise={()=>{setReviseOpen(true);document.getElementById('step-scope')?.scrollIntoView({behavior:'smooth',block:'start'});}}/>}
      {history.length>0&&<div className="section-gap"><h4 className="h-sub">Decision history</h4>{history.map(v=><div className="history" key={v.id}><strong>Version {v.version} · {label(v.status)}</strong><span>{formatInZone(v.created,timeZone)}</span>{v.signer&&<p>{v.signer} · {formatInZone(v.decided,timeZone)}</p>}{v.comment&&<p className="line-list">{v.comment}</p>}{!v.revoked?<a className="help-link" href={'/review/'+v.token} target="_blank" rel="noreferrer">View fixed scope</a>:<span className="fine">Review link revoked</span>}{v.status!=='pending'&&v.decided&&<> · <a className="help-link" href={receiptUrl(v)} download>PDF receipt</a></>}</div>)}</div>}
      <p className="fine">Your projects are private to your account. Review links are accessible to anyone who has the link.</p>
     </section>
  );
}
