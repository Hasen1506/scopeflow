'use client';
// Shared building blocks of the restructured workspace: stage chip, the Scope → Approval → Changes → Payment
// tracker, the "next step" callout, project status cards and the summary strip. Both themes, tokens only.
import {Check,AlertTriangle,Circle,ArrowRight} from 'lucide-react';
import type {ReactNode} from 'react';
import {STAGE_LABEL,type StageId,type Step} from '@/lib/stage';

export function StageChip({stage}:{stage:StageId}){return <span className={'stage-chip stage-'+stage}>{STAGE_LABEL[stage]}</span>;}

/** Four steps as one line. Each step is a link to its section on the project page (keys 1–4 do the same). */
export function StageTracker({steps,compact=false,linked=true}:{steps:Step[];compact?:boolean;linked?:boolean}){
 return <ol className={'tracker'+(compact?' compact':'')} aria-label="Project stages">{steps.map((s,i)=>{
  const icon=s.state==='done'?<Check size={compact?11:13} strokeWidth={2.4}/>:s.state==='attention'?<AlertTriangle size={compact?11:13} strokeWidth={2.2}/>:s.state==='current'?<Circle size={compact?8:9} fill="currentColor" strokeWidth={0}/>:<span className="tracker-num">{i+1}</span>;
  const body=<><span className="tracker-dot" aria-hidden="true">{icon}</span><span className="tracker-text"><span className="tracker-label">{s.label}</span>{!compact&&<span className="tracker-note">{s.note}</span>}</span></>;
  const sr=<span className="sr-only">{`: ${s.state==='todo'?'not started':s.state==='attention'?'needs attention':s.state}, ${s.note}`}</span>;
  return <li key={s.id} className={'tracker-step is-'+s.state} aria-current={s.state==='current'||s.state==='attention'?'step':undefined}>{linked?<a href={'#step-'+s.id}>{body}{sr}</a>:<span>{body}{sr}</span>}</li>;
 })}</ol>;
}

/** The one thing to do next on this screen. Actions are the real controls, never a copy of another button. */
export function NextStep({title,children,actions,tone='info'}:{title:ReactNode;children?:ReactNode;actions?:ReactNode;tone?:'info'|'attention'|'ok'}){
 return <aside className={'next-step tone-'+tone} aria-label="Next step"><div className="next-step-body"><p className="next-step-eyebrow"><ArrowRight size={13} aria-hidden="true"/>Next step</p><p className="next-step-title">{title}</p>{children&&<p className="next-step-detail">{children}</p>}</div>{actions&&<div className="actions next-step-actions">{actions}</div>}</aside>;
}

export function SummaryStrip({items}:{items:{label:string;value:string;note?:string}[]}){
 return <dl className="summary-strip">{items.map(i=><div key={i.label}><dt>{i.label}</dt><dd><strong>{i.value}</strong>{i.note&&<span>{i.note}</span>}</dd></div>)}</dl>;
}
