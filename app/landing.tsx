'use client';
import Link from 'next/link';
import {ArrowUpRight,BadgeCheck,BellRing,FileCheck2,IndianRupee,LibraryBig,Palette,Plug,Radar,Repeat2,Scale,ShieldCheck,Sparkles} from 'lucide-react';
import {ReviewVignette} from './ui';

// What a signed-out visitor sees at /. It holds no draft and no account data, so nothing typed in
// the editor (by this visitor or a previous account on this browser) can show up here.
const STEPS=[
 {title:'Write the scope',body:'Deliverables, acceptance criteria, what is excluded, fee, tax, deposit, payment terms and revision rounds. Start from a template, a brief or a blank page.'},
 {title:'Your client approves it',body:'Send one review link. The client reads the exact version, confirms it with an email or phone code when you ask for one, and approves or requests changes.'},
 {title:'Changes become change orders',body:'Every "small extra" is priced and approved as a change order against the locked version, so the agreement keeps up with the work.'},
 {title:'Invoice, get paid, keep the record',body:'Invoices, online payments and refunds land on the same signed record, ready as a statement or a dispute pack.'},
];
const FEATURES:{icon:typeof Radar;title:string;body:string}[]=[
 {icon:FileCheck2,title:'Version-locked approvals',body:'Each saved version is fixed. Clients approve on a review link with optional email, SMS or WhatsApp codes and countersigners such as finance.'},
 {icon:BadgeCheck,title:'Signed receipts anyone can verify',body:'Decisions and ledger entries are signed and hash-chained. Receipts are PDFs with a QR code that checks them on the verify page.'},
 {icon:Repeat2,title:'Change orders and revision banks',body:'Track revision rounds, or a bank of hours or money, and record priced change orders the client approves.'},
 {icon:Radar,title:'Scope-creep radar',body:'Paste or forward a client message and see whether it is in scope, excluded or new work, across languages, before you say yes.'},
 {icon:IndianRupee,title:'GST invoices and payments',body:'Numbered tax invoices with CGST, SGST or IGST, milestones and due dates, deposits and invoices paid online through Razorpay or Stripe, and refunds.'},
 {icon:ShieldCheck,title:'Evidence that holds up',body:'Signed PDFs with trusted timestamps, a tamper-evident ledger and a dispute pack with a BSA 2023 section 63 certificate template.'},
 {icon:BellRing,title:'Reminders that follow up for you',body:'Automatic, polite reminders for unanswered scopes and overdue invoices, and a log of when the client opened the link.'},
 {icon:Sparkles,title:'AI drafting and a clarity check',body:'Draft a scope from a brief, catch vague wording with one-click rewrites, and see what clients often assume is included.'},
 {icon:Palette,title:'Your brand on everything',body:'Your logo, colour and reply-to address on the review page, PDFs and emails your clients receive.'},
 {icon:LibraryBig,title:'Templates you keep improving',body:'Save scopes as templates with tags and revision history, and share a template with a link.'},
 {icon:Plug,title:'Works with ChatGPT and your tools',body:'Connect ChatGPT through MCP, use API keys, or import drafts from Muse.'},
 {icon:Scale,title:'Your data, your rules',body:'Retention periods per project, legal holds, full export and account deletion.'},
];

export default function Landing({onTry}:{onTry:()=>void}){
 return <div className="landing">
  <section className="hero hero-split" aria-labelledby="hero-title">
   <div><p className="eyebrow ruled">Scopes · approvals · change orders · payments</p><h1 id="hero-title">Good work starts with a <em>clear agreement.</em></h1><p className="tagline">Define the work, get it approved on a version-locked link, and keep the next “small change” on the record.</p>
    <div className="actions"><Link className="primary" href="/auth/sign-up?return_to=%2F">Create an account<ArrowUpRight size={17}/></Link><Link className="secondary" href="/auth/sign-in?return_to=%2F">Sign in</Link></div>
    <p className="fine">Or <button className="help-link" onClick={onTry}>try the editor without an account</button>. Nothing is saved until you sign in.</p></div>
   <ReviewVignette/>
  </section>

  <section className="lp-section" aria-labelledby="lp-how"><p className="eyebrow ruled">How it works</p><h2 id="lp-how">From first brief to <em>final payment</em></h2>
   <ol className="lp-steps">{STEPS.map((s,i)=><li key={s.title}><span className="step-num" aria-hidden="true">{i+1}</span><div><h3>{s.title}</h3><p>{s.body}</p></div></li>)}</ol>
  </section>

  <section className="lp-section" aria-labelledby="lp-features"><p className="eyebrow ruled">Features</p><h2 id="lp-features">Everything a scope needs, <em>on one record</em></h2>
   <ul className="lp-features">{FEATURES.map(({icon:Icon,title,body})=><li key={title} className="lp-card"><Icon size={20} aria-hidden="true"/><h3>{title}</h3><p>{body}</p></li>)}</ul>
   <p className="fine">Online payments, SMS codes, AI and trusted timestamps are available when this server has them set up.</p>
  </section>

  <section className="lp-cta" aria-labelledby="lp-start"><div><h2 id="lp-start">Write your next scope <em>once.</em></h2><p>Let the record do the remembering.</p></div>
   <div className="actions"><Link className="primary" href="/auth/sign-up?return_to=%2F">Create an account<ArrowUpRight size={17}/></Link><button className="secondary" onClick={onTry}>Try the editor</button></div>
  </section>
 </div>;
}
