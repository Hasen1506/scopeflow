'use client';
import Link from 'next/link';
import {Plus} from 'lucide-react';
import {StageChip,StageTracker,NextStep,SummaryStrip} from '../workflow';
import {InsightsPanel} from '../insights-panel';
import {EmptyState,Skeleton} from '../ui';
import {daysAgo} from '@/lib/time';
import {moneyMap} from './state';
import type {Ws} from './state';

/** The unsaved draft kept with the account: shown on the Projects home so it is not lost. */
export function UnsavedCard({title,sync,onOpen}:{title:string;sync:'saving'|'saved'|'error'|null;onOpen:()=>void}){return <div className="project-card stage-draft unsaved-card"><div className="pc-head"><p className="pc-title">{title.trim()||'Untitled scope'}</p><StageChip stage="draft"/></div><p className="pc-client">Not saved yet · {sync==='error'?'could not reach your account; kept on this page and retrying':'kept with your account'}</p><div className="pc-next"><p>Finish it and save to get a review link</p><button className="secondary" onClick={onOpen}>Continue draft</button></div></div>;}

export function projectList(w:Ws){const {active,amountLine,busy,cardAction,cards,count,dueByCurrency,dueCount,filtered,ins,insightsOpen,loading,newScope,overview,query,scopes,searchRef,select,setInsightsOpen,setQuery,setStatusFilter,signedIn,statusFilter,unsavedCard,urgent,waiting}=w;
  return (loading?<Skeleton cards={3} lines={1} label="Loading projects…"/>:!signedIn?<EmptyState title="Your projects live here">Sign in to see your saved projects, where each one stands and what to do next. <Link className="help-link" href="/auth/sign-in?return_to=%2F">Sign in</Link></EmptyState>
    :scopes.length===0?<><NextStep title="Start with your first scope" actions={<button className="primary" onClick={()=>void newScope()}><Plus size={16}/>Write your first scope</button>}>Pick a template or start blank. Saving creates the review link your client approves; every project then shows up here with its stage and what to do next.</NextStep>{unsavedCard}<EmptyState title="No saved scopes yet">Projects appear here as status cards: draft, awaiting approval, approved, change pending.</EmptyState></>
    :<>
     {urgent&&<NextStep tone={urgent.stage==='changes_requested'||urgent.stage==='change_pending'?'attention':urgent.stage==='approved'?'ok':'info'} title={<>{urgent.next.title}<span className="quiet"> · {urgent.s.content.title}</span></>} actions={cardAction(urgent)}>{urgent.next.detail}</NextStep>}
     <SummaryStrip items={[
      {label:'Awaiting approval',value:String(count('awaiting')),note:count('changes_requested')?`${count('changes_requested')} with changes requested`:'scopes with a live link'},
      {label:'Change orders pending',value:String(cards.reduce((n,c)=>n+(c.ov?.pending_changes??0),0)),note:'awaiting your clients'},
      {label:'Agreed value',value:ins?moneyMap(ins.fee_now):'…',note:ins?`before tax, ${ins.projects} approved agreement${ins.projects===1?'':'s'}`:undefined},
      {label:'Still to collect',value:overview?moneyMap(dueByCurrency):'…',note:overview?(dueCount?`with tax, on ${dueCount} approved project${dueCount===1?'':'s'}`:'nothing outstanding'):undefined},
     ]}/>
     <div className="list-tools"><label>Search projects <span className="kbd" aria-hidden="true">/</span><input ref={searchRef} type="search" value={query} onChange={e=>setQuery(e.target.value)} placeholder="Project or client name" aria-keyshortcuts="/"/></label><label>Stage<select value={statusFilter} onChange={e=>setStatusFilter(e.target.value)}><option value="all">All active projects</option><option value="changes_requested">Changes requested</option><option value="change_pending">Change pending</option><option value="awaiting">Awaiting approval</option><option value="draft">Draft (no live link)</option><option value="approved">Approved</option><option value="archived">Archived</option></select></label></div>
     {unsavedCard}
     {filtered.length===0?<div className="empty-filter"><p className="empty">No projects match these filters.</p><button className="secondary" onClick={()=>{setQuery('');setStatusFilter('all');}}>Clear filters</button></div>
     :<ul className="project-grid" aria-label="Projects">{filtered.map(c=><li key={c.s.project_id} className={'project-card stage-'+c.stage+(c.s.project_id===active?.project_id?' active':'')}>
      <div className="pc-head"><h3 className="pc-title"><button type="button" className="pc-open" onClick={()=>void select(c.s)} disabled={busy} aria-describedby={'pc-'+c.s.project_id}>{c.s.content.title}</button></h3><StageChip stage={c.stage}/></div>
      <div id={'pc-'+c.s.project_id} className="pc-body"><p className="pc-client">{c.s.content.client} · Version {c.s.version}{(()=>{if(c.stage==='changes_requested'){const a=daysAgo(c.s.decided);return a.text?<span> · answered {a.text}</span>:null;}if(c.stage!=='awaiting')return null;const w=waiting(c);if(!w.age.text)return null;const what=w.reminders?`reminded ${w.age.text}`:c.ov?.last_sent?`emailed ${w.age.text}`:`link created ${w.age.text}`;/* #14: nothing was emailed; the link was only made */const seen=c.ov?(c.ov.viewed?`opened ${daysAgo(c.ov.viewed.last).text}`:'not opened yet'):'';return <>{w.due?<span className="warn-ink"> · {what}, worth a nudge</span>:<span> · {what}</span>}{seen&&<span> · {seen}</span>}</>;})()}</p><StageTracker steps={c.steps} compact linked={false}/><p className="pc-money">{amountLine(c)}</p></div>
      <div className="pc-next"><p>{c.next.title}</p>{cardAction(c)}</div>
     </li>)}</ul>}
     <details className="disclosure insights-more" onToggle={e=>setInsightsOpen(e.currentTarget.open)}><summary>All insights <span className="quiet">· by client, revision rounds, goodwill</span></summary>{insightsOpen&&<InsightsPanel signedIn={signedIn}/>}</details>
    </>
  );
}
