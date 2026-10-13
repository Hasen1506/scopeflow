import Link from 'next/link';
import type {Dispatch,SetStateAction} from 'react';
import {BellRing,Copy,Download,FilePlus2} from 'lucide-react';
import type {Version} from '@/lib/scope';
import type {nextStep} from '@/lib/stage';
import type {OvProject} from './types';

/** Scroll to a section of the open project (the top when id is null), honouring reduced motion. */
export function toTop(id:string|null){const el=document.getElementById(id??'project-top');el?.scrollIntoView?.({block:'start',behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'});}

type NextCtx={active:Version|null;signedIn:boolean;loading:boolean;next:ReturnType<typeof nextStep>;archived:string|null;activeOv:OvProject|undefined;busy:boolean;mailOn:boolean;
 remind:(s:Version)=>Promise<void>;sendForSignature:()=>Promise<void>;copyLinkToSend:()=>Promise<void>;copyReviewLink:()=>Promise<string|null>;setReviseOpen:(open:boolean)=>void;receiptUrl:(v:Version)=>string;
 setCoSignal:Dispatch<SetStateAction<number>>;setActionError:(m:string)=>void;setProjectAction:(a:'archive'|'restore'|'delete'|null)=>void};
/** The buttons in the open project's "next step" callout. */
export function nextActionsFor({active,signedIn,loading,next,archived,activeOv,busy,mailOn,remind,sendForSignature,copyLinkToSend,copyReviewLink,setReviseOpen,receiptUrl,setCoSignal,setActionError,setProjectAction}:NextCtx){
 return !active?(!signedIn&&!loading?<Link className="primary" href="/auth/sign-in?return_to=%2F">Sign in</Link>:null)
  :next.kind==='send'?<>{!archived&&(activeOv?.last_sent?<button className="primary" disabled={busy||activeOv.reminders>=3} onClick={()=>void remind(active)}><BellRing size={15}/>Send a reminder</button>:(mailOn?<button className="primary" disabled={busy} onClick={sendForSignature} title="Email the review link to the client">Send for signature</button>:<button className="primary" disabled={busy||!!active.revoked} onClick={()=>void copyLinkToSend()} aria-describedby="send-off-note"><Copy size={15}/>Copy link to send</button>))}{(mailOn||archived||activeOv?.last_sent)&&<button className="secondary" disabled={!!active.revoked} onClick={copyReviewLink}><Copy size={15}/>Copy review link</button>}{!mailOn&&!archived&&!activeOv?.last_sent&&<p id="send-off-note" className="fine">Email isn’t set up here yet, so Scopeflow can’t send it for you. This copies the review link to paste into your own email or chat.</p>}</>
  :next.kind==='copy_link'?<button className="primary" disabled={!!active.revoked} onClick={copyReviewLink}><Copy size={15}/>Copy review link</button>
  :next.kind==='revise'?<button className="primary" onClick={()=>{setReviseOpen(true);requestAnimationFrame(()=>toTop('step-scope'));}}>Revise scope</button>
  :next.kind==='change_order'?<><a className="primary" href={receiptUrl(active)} download><Download size={15}/>Download receipt</a><button className="secondary" disabled={busy} onClick={()=>setCoSignal(n=>n+1)}><FilePlus2 size={15}/>Record change order</button></>
  :next.kind==='restore'?<button className="primary" disabled={busy} onClick={()=>{setActionError('');setProjectAction('restore');}}>Restore project</button>
  :<a className="secondary" href="#step-approval">Go to approval</a>;
}
