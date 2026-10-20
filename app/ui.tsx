'use client';
/* eslint-disable @next/next/no-img-element -- decorative art is pre-optimised WebP with fixed dimensions; next/image adds nothing here */
import {Check,ChevronDown,Lock,Menu,X} from 'lucide-react';
import {useEffect,useRef,useState} from 'react';
import Link from 'next/link';
import {usePathname} from 'next/navigation';
import {clearSessionHint, rememberSession} from '@/lib/theme';
import {forgetDrafts} from '@/lib/draft-storage';
/** ScopeFlow's mark: a reticle over a river (scope + flow). */
export function Mark(){return <span className="mark" aria-hidden="true"><svg viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"><circle cx="16" cy="16" r="10.5"/><path d="M16 1.8v4.4M16 25.8v4.4M1.8 16h4.4M25.8 16h4.4"/><path d="M8.6 14.2c2.4-2 4.8-2 7.4 0s5 2 7.4 0M8.6 19c2.4-2 4.8-2 7.4 0s5 2 7.4 0" strokeWidth="1.4"/></svg></span>;}
export function Brand({beta=true}:{beta?:boolean}){return <Link className="brand" href="/" prefetch={false} aria-label="Scopeflow home"><Mark/><span className="wordmark">Scope<em>flow</em></span>{beta&&<span className="beta">EARLY BETA</span>}</Link>;}
/** Load the auth document directly. Client routing paints the marketing page on the way. */
export function loadDocument(event: React.MouseEvent<HTMLAnchorElement>) {
  if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  event.preventDefault();
  window.location.assign(event.currentTarget.href);
}
/** Everything that is about the account rather than a project lives under one menu (was three top-level pages). */
const ACCOUNT=[{href:'/account',label:'Settings',hint:'Business, branding, defaults, data'},{href:'/account/team',label:'Team',hint:'Seats, shared rate card'},{href:'/connect',label:'Connect',hint:'AI assistants and API'},{href:'/plans',label:'Plans',hint:'Free, Freelancer, Studio'}];
export function Header(){const path=usePathname();const [user,setUser]=useState<{email?:string}|null>(null);const inAccount=ACCOUNT.some(a=>path===a.href||path?.startsWith(a.href+'/'));
 // Session is read from the auth endpoint so the landing page does not download the auth SDK.
 useEffect(()=>{let live=true;fetch('/api/auth/get-session',{credentials:'same-origin'}).then(r=>r.ok?r.json():null).then(data=>{if(!live)return;const next=data?.user??null;setUser(next);if(next)rememberSession(true);}).catch(()=>{});return()=>{live=false;};},[]);
 // Below ~720px the nav, Account menu and theme controls collapse behind one Menu button (aria-expanded;
 // Escape or a click outside closes it and returns focus to the button; a route change closes it).
 const [open,setOpen]=useState(false);const [accountOpen,setAccountOpen]=useState(false);const toggle=useRef<HTMLButtonElement>(null);const wrap=useRef<HTMLDivElement>(null);
 const [openedOn,setOpenedOn]=useState(path);if((open||accountOpen)&&openedOn!==path){setOpen(false);setAccountOpen(false);setOpenedOn(path);}
 useEffect(()=>{if(!open)return;
  const close=(focus:boolean)=>{setOpen(false);if(focus)toggle.current?.focus();};
  const onKey=(e:KeyboardEvent)=>{if(e.key!=='Escape')return;close(true);};
  const onDown=(e:PointerEvent)=>{const t=e.target as Node;if(wrap.current?.contains(t)||toggle.current?.contains(t))return;close(false);};
  document.addEventListener('keydown',onKey);document.addEventListener('pointerdown',onDown);
  return()=>{document.removeEventListener('keydown',onKey);document.removeEventListener('pointerdown',onDown);};},[open]);
 useEffect(()=>{if(!accountOpen)return;
  const onKey=(e:KeyboardEvent)=>{if(e.key!=='Escape')return;e.preventDefault();setAccountOpen(false);};
  const onDown=(e:PointerEvent)=>{const t=e.target as Node;if(t instanceof Element&&t.closest('.account-wrap'))return;setAccountOpen(false);};
  document.addEventListener('keydown',onKey);document.addEventListener('pointerdown',onDown);
  return()=>{document.removeEventListener('keydown',onKey);document.removeEventListener('pointerdown',onDown);};},[accountOpen]);
 // On the workspace itself, "Projects" switches to the Projects home without a reload.
 const home=(e:React.MouseEvent)=>{if(path==='/'&&!e.metaKey&&!e.ctrlKey&&!e.shiftKey){e.preventDefault();window.dispatchEvent(new Event('scopeflow:home'));}};
 return <header className={'topbar'+(open?' menu-open':'')}><Brand/><button ref={toggle} type="button" className="menu-toggle" aria-expanded={open} aria-controls="site-menu" onClick={()=>{setOpenedOn(path);setOpen(o=>!o);}}>{open?<X size={18} aria-hidden="true"/>:<Menu size={18} aria-hidden="true"/>}<span>Menu</span></button><div className="nav-wrap" id="site-menu" ref={wrap} onClick={e=>{if(open&&(e.target as Element).closest?.('a'))setOpen(false);}}><nav className="navlinks" aria-label="Main"><Link href="/" prefetch={false} onClick={home} aria-current={path==='/'&&user?'page':undefined}>Projects</Link><Link href="/templates" prefetch={false} aria-current={path?.startsWith('/templates')?'page':undefined}>Templates</Link>
  <div className="account-wrap"><button type="button" className={'nav-menu'+(inAccount?' is-current':'')} aria-expanded={accountOpen} aria-haspopup="menu" aria-controls="account-menu" data-state={accountOpen?'open':'closed'} onClick={()=>setAccountOpen(o=>!o)}>Account<ChevronDown size={14} aria-hidden="true"/></button>{accountOpen&&<div id="account-menu" className="account-menu" role="menu">{user&&<div className="menu-who" role="presentation">Signed in as<b>{user.email}</b></div>}{ACCOUNT.map(a=><Link key={a.href} role="menuitem" href={a.href} prefetch={false} aria-current={path===a.href?'page':undefined}><span className="menu-label">{a.label}</span><span className="menu-hint">{a.hint}</span></Link>)}</div>}</div>
  {/* eslint-disable-next-line @next/next/no-location-assign-relative-destination -- full document load after sign-out; client routing kept the session hint and showed the signed-in home */}
  {user?<button className="help-link" onClick={async()=>{const pending:Promise<unknown>[]=[];window.dispatchEvent(new CustomEvent('scopeflow:flush',{detail:pending}));await Promise.allSettled(pending);const result=await fetch('/api/auth/sign-out',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:'{}'});if(result.ok){clearSessionHint();forgetDrafts();window.location.assign('/auth/sign-in?signed_out=1');}}}>Sign out</button>:<Link href="/auth/sign-in" prefetch={false} onClick={loadDocument} aria-current={path?.startsWith('/auth/')?'page':undefined}>Sign in</Link>}</nav></div></header>;}
export type ApiError=Error&{status?:number;code?:string;data?:Record<string,unknown>};
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- callers read endpoint-specific JSON shapes
export async function api(path:string,options?:RequestInit):Promise<any>{const r=await fetch(path,options);let data:Record<string,unknown>={};try{data=await r.json();}catch{/* non-JSON error page */}if(!r.ok){const error:ApiError=new Error(typeof data.error==='string'?data.error:'Request failed. Please try again.');error.status=r.status;error.code=typeof data.code==='string'?data.code:undefined;error.data=data;throw error;}return data;}
export const post=(data:unknown)=>({method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
/** Etched survey-stake vignette (decorative). */
export function Vignette({className='plate'}:{className?:string}){return <div className={className} aria-hidden="true"><img src="/art/survey-stake.webp" alt="" width={360} height={360} loading="lazy" decoding="async"/></div>;}
/** Signed-out hero "product vignette": a miniature client review, built from the app's own tokens and chips.
 *  Illustrative only (labelled Example); exposed to assistive tech as a single described image. */
export function ReviewVignette(){return <div className="vignette-card" role="img" aria-label="Example of a client review in Scopeflow: Brand refresh for Kavya Studio, version 2 locked, three deliverables totalling ₹54,000, approved by the client, with a pending change order for two more social templates at ₹6,000.">
 <div className="vc-doc" aria-hidden="true">
  <div className="vc-head"><span className="vc-example">Example</span><span className="vc-chip"><Lock size={11} strokeWidth={2.2}/>Version 2 · locked</span></div>
  <p className="vc-title">Brand refresh <span className="vc-dash">—</span> <em>Kavya Studio</em></p>
  <ul className="vc-items">
   <li><Check size={15}/><span>Logo system</span><span className="vc-amt">₹24,000</span></li>
   <li><Check size={15}/><span>Brand guidelines</span><span className="vc-amt">₹18,000</span></li>
   <li><Check size={15}/><span>Social kit · 4 templates</span><span className="vc-amt">₹12,000</span></li>
  </ul>
  <div className="vc-total"><span>Total</span><strong>₹54,000</strong>
   <div className="vc-seal"><span className="vc-seal-top">Approved</span> <span className="vc-seal-mid">by client</span> <span className="vc-seal-date">3 Oct 2026</span></div></div>
 </div>
 <div className="vc-slip" aria-hidden="true"><span className="vc-pin"/><strong>Change order #1</strong><span className="vc-slip-body"><span className="vc-co-what">+2 social templates, </span>+₹6,000</span><span className="vc-pending">Pending</span></div>
</div>;}
export function EmptyState({title,children}:{title:string;children?:React.ReactNode}){return <div className="empty-state"><span aria-hidden="true"><img src="/art/survey-stake.webp" alt="" width={96} height={96} loading="lazy" decoding="async"/></span><div><strong>{title}</strong>{children&&<p>{children}</p>}</div></div>;}
/** Loading placeholder with the shape of what is coming, so nothing jumps when it arrives. */
export function Skeleton({lines=0,cards=0,label='Loading…'}:{lines?:number;cards?:number;label?:string}){return <div className="skeleton-stack" aria-busy="true"><span className="sr-only">{label}</span>{Array.from({length:cards},(_,i)=><span key={'c'+i} className="skeleton skeleton-card"/>)}{Array.from({length:lines},(_,i)=><span key={'l'+i} className="skeleton skeleton-line" style={{width:`${92-i*14}%`}}/>)}</div>;}
