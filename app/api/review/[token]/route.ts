import { z } from 'zod';
import {after} from 'next/server';
import {timestampRecord} from '@/lib/timestamps';
import {db,json,body,safeOrigin,allowWrite,allowRead,parseRow,failure,ipKey} from '@/lib/server';
import {loadLedger, anchorOf} from '@/lib/ledger-server';
import {sha256} from '@/lib/ledger';
import {anchorMessage, signRecord, publicSigningKey} from '@/lib/signing';
import {decisionContext, isOwnerSession} from '@/lib/decision';
import {depositView} from '@/lib/deposit-server';
import {clientInvoices} from '@/lib/invoice-server';
import {zoneOrUtc} from '@/lib/time';
import {linkExpired,linkExpires} from '@/lib/link';
import {cosignStatus,parseCosigners,type Cosign} from '@/lib/cosign';
import {maskDestination, signEvidence, type IdentityEvidence, type OtpChannel} from '@/lib/otp';
const identityCheck=(channel:OtpChannel,to:string|null)=>({method:channel+'_otp',channel,to:to?maskDestination(channel,to):null});
import {otpEvidence} from '@/lib/otp-server';
type Ctx={params:Promise<{token:string}>};
type ReviewRow=Record<string,unknown>&{id:string;project_id:string;version:number;latest:number;owner:string;status:string;content:string;token:string;created:string;signature:string|null;decision_context:string|null;require_otp:boolean;client_email:string|null;client_phone:string|null;otp_channel:string|null;cosigners:string|null;link_issued:string|null;link_expiry_days:number|null};
const expiredReply=(row:ReviewRow)=>json({error:`This review link expired on ${new Date(linkExpires(row)!).toUTCString().slice(5,16)}. Ask the creator for a new link.`,code:'link_expired',expired:linkExpires(row)},410);
async function find(token:string){if(!/^[a-f0-9]{64}$/.test(token))return null;return db().prepare('SELECT v.*,p.latest,p.owner,p.timezone,p.require_otp,p.client_email,p.client_phone,p.otp_channel,p.cosigners,p.link_issued,p.link_expiry_days FROM versions v JOIN projects p ON p.id=v.project_id WHERE v.token=? AND v.revoked=0').bind(token).first<ReviewRow>();}
export async function GET(request:Request,ctx:Ctx){try{const {token}=await ctx.params;if(!await allowRead('review-ip:'+await ipKey(request),300))return json({error:'Too many requests. Try again in a minute.'},429);const row=await find(token);if(!row)return json({error:'This review link was not found.'},404);if(linkExpired(row))return expiredReply(row);
 // Owner-private "opened" log for this version; the creator previewing their own link does not count.
 if(!await isOwnerSession(request,row.owner)){const now=new Date().toISOString();await db().prepare('INSERT INTO review_views (project_id,version,first_viewed,last_viewed,views) VALUES (?,?,?,?,1) ON CONFLICT (project_id,version) DO UPDATE SET last_viewed=excluded.last_viewed,views=review_views.views+1').bind(row.project_id,row.version,now,now).run().catch(()=>{/* never block the review on the log */});}
 // SF-11: a revoked version's content is not disclosed through the next version's link.
 const previous=await db().prepare('SELECT content FROM versions WHERE project_id=? AND version=? AND revoked=0').bind(row.project_id,row.version-1).first<{content:string}>();
 const {owner:_owner,decision_context:_context,timezone,require_otp:requireOtp,client_email:clientEmail,client_phone:clientPhone,otp_channel:otpChannel,cosigners:_cosigners,link_issued:_issued,link_expiry_days:_days,...rest}=row;const expires=linkExpires(row);const {token:_,...scope}=parseRow(rest,{withToken:false}) as Record<string,unknown>;
 // The approved latest version doubles as the client's view of the post-approval ledger.
 let ledger=null;if(row.version===row.latest&&row.status==='approved'){const l=await loadLedger(row.project_id,{forClient:true});if(l.baseline?.id===row.id)ledger={entries:l.entries,agreement:l.agreement,anchors:l.anchors,head:l.head,seal:l.seal,signatures:l.signatures,invoices:await clientInvoices(row.project_id,row.version,l.entries,timezone as string|null)};}
 // PR F: the deposit due on signature, once approved (null when the scope has none).
 const deposit=row.status==='approved'&&row.version===row.latest?await depositView(row.project_id,row.version,JSON.parse(row.content)):null;
 // PR B: whether this decision (or a pending change-order decision) needs an email code first, and where it goes (masked).
 // Countersignatures on the approved latest version (roles the creator listed).
 let cosign=null;if(row.status==='approved'&&row.version===row.latest){const required=parseCosigners(row.cosigners);if(required.length){const signed=await db().prepare('SELECT cosigner_id,role,signer,signed,signature FROM version_cosigns WHERE project_id=? AND version=?').bind(row.project_id,row.version).all<Cosign>();cosign=cosignStatus(required,signed.results);}}
 const identity_check=requireOtp&&(row.status==='pending'||(ledger&&(ledger.agreement?.pending??0)>0)||(cosign&&cosign.waiting>0))?identityCheck((otpChannel??'email') as OtpChannel,(otpChannel&&otpChannel!=='email'?clientPhone:clientEmail) as string|null):null;
 return json({scope:{...scope,signature:row.signature??null},previous:previous?JSON.parse(previous.content):null,ledger,signing_key:publicSigningKey(),...(deposit?{deposit}:{}),time_zone:zoneOrUtc(timezone as string|null),...(expires?{link_expires:expires}:{}),...(identity_check?{identity_check}:{}),...(cosign?{cosign}:{})});}catch(e){return failure(e);}}
export async function POST(request:Request,ctx:Ctx){try{
 if(!safeOrigin(request))return json({error:'Origin not allowed.'},403);const {token}=await ctx.params;const row=await find(token);if(!row)return json({error:'This review link was not found.'},404);if(linkExpired(row))return expiredReply(row);
 if(!await allowWrite('review:'+row.id,10))return json({error:'Too many attempts. Try again in a minute.'},429);
 let raw;try{raw=await body(request);}catch{return json({error:'Provide valid JSON under 24 KB.'},400);}
 // SF-15: the reviewer's acknowledgement and the exact content they saw are required and recorded.
 const input=z.object({decision:z.enum(['approved','changes_requested']),signer:z.string().trim().min(2).max(120),comment:z.string().trim().max(3000),version:z.number().int(),acknowledged:z.literal(true),content_sha256:z.string().regex(/^[a-f0-9]{64}$/),otp_session:z.string().regex(/^[a-f0-9]{64}$/).optional()}).strict().safeParse(raw);
 if(!input.success)return json({error:'Enter your name, confirm you reviewed this version, and choose a decision.'},400);
 if(input.data.decision==='changes_requested'&&!input.data.comment)return json({error:'Please describe the changes you need.'},400);
 if(input.data.version!==row.version)return json({error:'Version mismatch. Reload this review.'},409);
 const contentHash=await sha256(JSON.stringify(JSON.parse(row.content)));
 if(input.data.content_sha256!==contentHash)return json({error:'This version changed or did not load completely. Reload this review before deciding.'},409);
 // PR B: when the creator requires it, the reviewer must have verified a code sent to the client email.
 let evidence:IdentityEvidence|null=null;
 if(row.require_otp){
  if(!input.data.otp_session)return json({error:'Confirm your email with the code we send you before recording a decision.',code:'otp_required'},403);
  evidence=await otpEvidence(row.id,input.data.otp_session);
  if(!evidence)return json({error:'Your email confirmation expired. Send a new code and try again.',code:'otp_required'},403);
 }
 const decided=new Date().toISOString();
 const anchor=await anchorOf({project_id:row.project_id,version:row.version,content:row.content,signer:input.data.signer,decided});
 const signature=signRecord(anchorMessage(anchor));
 const evidenceSignature=evidence?await signEvidence(anchor,evidence):null;
 const context=await decisionContext(request,row.owner,{acknowledged:true,content_sha256:contentHash,...(evidence?{identity:evidence,identity_signature:evidenceSignature}:{})});
 const r=await db().prepare("UPDATE versions SET status=?,signer=?,comment=?,decided=?,signature=?,decision_context=? WHERE id=? AND token=? AND revoked=0 AND status='pending' AND version=(SELECT latest FROM projects WHERE id=versions.project_id)").bind(input.data.decision,input.data.signer,input.data.comment,decided,signature,JSON.stringify(context),row.id,token).lock('scopeflow:project:'+row.project_id).run();
 if(!r.meta.changes)return json({error:'This version already has a decision or has been replaced. Ask the creator for the latest link.'},409);
 // RFC 3161: an independent timestamp authority dates the decision's fingerprint (when configured), after the response.
 after(()=>timestampRecord(row.project_id,row.version,'decision',anchor));
 // SF-04: a receipt the client can keep; it lets them detect any later rewrite.
 return json({status:input.data.decision,receipt:{project_id:row.project_id,version:row.version,signer:input.data.signer,decided,content_sha256:contentHash,anchor,signature,key:publicSigningKey(),...(evidence?{identity:evidence,identity_signature:evidenceSignature}:{})}});
}catch(e){return failure(e);}}
