import {BellRing,Copy,FilePlus2} from 'lucide-react';
import {money,formatMoney,type Version} from '@/lib/scope';
import {stageOf,trackerSteps,nextStep,type StageId} from '@/lib/stage';
import {daysAgo} from '@/lib/time';
import {STALE_DAYS,type OvProject,type Overview} from './types';

// Projects home: one card per project, its stage and next step, filtered and ordered by what needs the owner first.
export const PRIORITY:Record<StageId,number>={changes_requested:0,change_pending:1,awaiting:2,draft:3,approved:4,archived:5};
export type Card={s:Version;ov:OvProject|undefined;stage:StageId;steps:ReturnType<typeof trackerSteps>;next:ReturnType<typeof nextStep>};
export function homeCards(scopes:Version[],ovById:Map<string,OvProject>,overview:Overview|null,statusFilter:string,query:string){
 const cards=scopes.map(s=>{const ov=ovById.get(s.project_id);const input={saved:true,status:s.status,revoked:s.revoked,archived:s.archived,pendingChanges:ov?.pending_changes??0,client:s.content.client};return {s,ov,stage:stageOf(input),steps:trackerSteps(input),next:nextStep(input)};});
 const filtered=cards.filter(c=>(statusFilter==='archived'?c.stage==='archived':c.stage!=='archived'&&(statusFilter==='all'||c.stage===statusFilter))&&[c.s.content.title,c.s.content.client].some(x=>x.toLowerCase().includes(query.toLowerCase()))).sort((x,y)=>PRIORITY[x.stage]-PRIORITY[y.stage]);
 const count=(st:StageId)=>cards.filter(c=>c.stage===st).length;
 const urgent=cards.filter(c=>c.stage!=='archived').sort((x,y)=>PRIORITY[x.stage]-PRIORITY[y.stage])[0];
 // Money still owed on approved agreements (agreed total with tax, less every payment on the record), per currency.
 const owed=(overview?.projects??[]).filter(p=>(p.balance??0)>0&&cards.some(c=>c.s.project_id===p.project_id&&c.stage!=='archived'));
 const dueByCurrency=owed.reduce<Record<string,number>>((m,p)=>({...m,[p.currency]:Math.round(((m[p.currency]??0)+(p.balance??0))*100)/100}),{}),dueCount=owed.length;
 return {cards,filtered,count,urgent,dueByCurrency,dueCount};
}
 /** How long an awaiting scope has waited since it was saved or last emailed, and whether a reminder is due. */
export const waiting=(c:Card)=>{const age=daysAgo(c.ov?.last_sent??c.s.created),reminders=c.ov?.reminders??0;return {age,reminders,due:c.stage==='awaiting'&&!c.s.revoked&&age.days>=STALE_DAYS&&reminders<3};};
type CardActions={busy:boolean;remind:(s:Version)=>Promise<void>;copy:(value:string,what?:string)=>Promise<void>;select:(s:Version,then?:'revise'|'change_order')=>Promise<void>};
export function cardActionFor(c:Card,{busy,remind,copy,select}:CardActions){
  const k=c.next.kind;
  if(k==='send'&&waiting(c).due)return <button className="secondary" disabled={busy} onClick={()=>void remind(c.s)}><BellRing size={15}/>Send a reminder</button>;
  if((k==='send'||k==='copy_link')&&!c.s.revoked)return <button className="secondary" onClick={()=>void copy(location.origin+'/review/'+c.s.token,'Review link')}><Copy size={15}/>Copy review link</button>;
  if(k==='revise')return <button className="secondary" disabled={busy} onClick={()=>void select(c.s,'revise')}>Revise scope</button>;
  if(k==='change_order')return <button className="secondary" disabled={busy} onClick={()=>void select(c.s,'change_order')}><FilePlus2 size={15}/>Record change order</button>;
  return <button className="secondary" disabled={busy} onClick={()=>void select(c.s)}>Open project</button>;
 }
export const amountLine=(c:Card)=>{const o=c.ov,cur=c.s.content.currency;if(!o)return <span><b>Quoted</b> {money(c.s.content)}</span>;
  if(o.agreed_fee===null)return <><span><b>Quoted</b> {formatMoney(o.quoted_fee,cur)}</span><span className="quiet">Not approved yet</span></>;
  return <><span><b>Approved</b> {formatMoney(o.agreed_fee,cur)}{o.agreed_total!==null&&o.agreed_total!==o.agreed_fee&&<span className="quiet"> · {formatMoney(o.agreed_total,cur)} with tax</span>}</span>{o.pending_changes>0&&<span className="warn-ink"><b>{o.pending_changes} change order{o.pending_changes>1?'s':''} pending</b>{o.pending_value?` · ${o.pending_value>0?'+':''}${formatMoney(o.pending_value,cur)}`:''}</span>}{o.balance===0?<span className="ok-ink"><b>Paid in full</b> · {formatMoney(o.paid,cur)}</span>:o.paid>0?<span><b>Received</b> {formatMoney(o.paid,cur)} · <b>Due</b> {formatMoney(o.balance??0,cur)}</span>:o.deposit_due!==null?<span><b>Deposit due</b> {formatMoney(o.deposit_due,cur)}</span>:o.balance!==null&&<span><b>Due</b> {formatMoney(o.balance,cur)}</span>}</>;};
