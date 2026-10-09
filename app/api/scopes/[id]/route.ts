import { z } from 'zod';
import {limits} from '@/lib/plans';
import { scopeSchema } from '@/lib/scope';
import { clientEmailSchema } from '@/lib/mail';
import { validTimeZone } from '@/lib/time';
import { otpAvailable, type OtpChannel } from '@/lib/otp';
import { cosignersSchema, parseCosigners } from '@/lib/cosign';
import { linkExpires } from '@/lib/link';
import { getUser } from '@/lib/auth/server';
import { lockKey } from '@/db/client';
import { db,json,ownerAuth,body,safeOrigin,allowWrite,allowRead,parseRow,secret,failure,hash } from '@/lib/server';
type Ctx={params:Promise<{id:string}>};
const PROJECT_COLUMNS='archived,client_email,timezone,require_otp,link_expiry_days,link_issued,client_phone,otp_channel,cosigners';
type ProjectRow={archived:string|null;client_email:string|null;timezone:string|null;require_otp:boolean;link_expiry_days:number|null;link_issued:string|null;client_phone:string|null;otp_channel:string|null;cosigners:string|null};
/** Owner-facing project settings. */
function projectSettings(p:ProjectRow){return {archived:p.archived??null,client_email:p.client_email??'',timezone:p.timezone??null,require_otp:!!p.require_otp,link_expiry_days:p.link_expiry_days??null,link_issued:p.link_issued??null,client_phone:p.client_phone??'',otp_channel:(p.otp_channel??'email') as OtpChannel,cosigners:parseCosigners(p.cosigners)};}
const LINK_HINT='Review links are shown only in the signed-in Scopeflow workspace, so an API token or connector can never act as the client.';
export async function GET(request:Request,ctx:Ctx){try{const auth=await ownerAuth(request);if(!auth)return json({error:'Sign in required.'},401);if(!await allowRead('owner:'+auth.user))return json({error:'Too many requests. Try again in a minute.'},429);const {id}=await ctx.params;const p=await db().prepare(`SELECT latest,${PROJECT_COLUMNS} FROM projects WHERE id=? AND owner=?`).bind(id,auth.user).first<ProjectRow&{latest:number}>();if(!p)return json({error:'Project not found.'},404);const r=await db().prepare('SELECT * FROM versions WHERE project_id=? ORDER BY version DESC').bind(id).all();const latest=r.results[0] as {status:string;created:string}|undefined;const cosigns=await db().prepare('SELECT cosigner_id,role,signer,signed,signature FROM version_cosigns WHERE project_id=? AND version=? ORDER BY signed').bind(id,p.latest).all();return json({versions:r.results.map(row=>parseRow(row,{withToken:auth.via==='session'})),project:{...projectSettings(p),link_expires:latest?linkExpires({...latest,link_issued:p.link_issued,link_expiry_days:p.link_expiry_days}):null},cosigns:cosigns.results});}catch(e){return failure(e);}}
export async function POST(request:Request,ctx:Ctx){try{
 if(!safeOrigin(request))return json({error:'Origin not allowed.'},403);const auth=await ownerAuth(request);if(!auth)return json({error:'Sign in required.'},401);const user=auth.user,session=auth.via==='session';const {id}=await ctx.params;
 const p=await db().prepare('SELECT latest,archived FROM projects WHERE id=? AND owner=?').bind(id,user).first<{latest:number;archived:string|null}>();if(!p)return json({error:'Project not found.'},404);
 if(p.archived)return json({error:'This project is archived. Restore it before saving a new version.',code:'archived'},409);
 if(!await allowWrite('owner:'+user))return json({error:'Write limit reached. Try again in a minute.'},429);
 let raw;try{raw=await body(request);}catch{return json({error:'Provide valid JSON under 24 KB.'},400);}
 if(!raw||typeof raw!=='object'||Array.isArray(raw))return json({error:'Provide a revision object.'},400);
 if(raw.expected_version!==p.latest)return json({error:'A newer version exists. Refresh the project before revising.'},409);
 if(raw.supersede_agreement!==undefined&&typeof raw.supersede_agreement!=='boolean')return json({error:'supersede_agreement must be true or false.'},400);
 const input=scopeSchema.safeParse(raw.content);if(!input.success)return json({error:input.error.issues.map(i=>`${i.path.join('.')}: ${i.message}`).join('; ')},400);
 if(p.latest>=limits().versions)return json({error:`Your plan supports up to ${limits().versions} versions per project.`,code:'plan_limit'},429);
 // SF-06: a new version replaces the approved agreement, including approved change
 // orders and recorded rounds. Never do that silently.
 const latest=await db().prepare("SELECT v.status,(SELECT COUNT(*) FROM ledger_entries e WHERE e.project_id=v.project_id AND e.baseline_version=v.version) AS entries FROM versions v WHERE v.project_id=? AND v.version=?").bind(id,p.latest).first<{status:string;entries:number}>();
 if(latest?.status==='approved'&&latest.entries>0&&raw.supersede_agreement!==true)return json({error:`Version ${p.latest} is an approved agreement with ${latest.entries} ledger ${latest.entries===1?'entry':'entries'} (change orders, rounds or delays). A new version replaces that agreement once approved. Start the revision from the current agreement, then confirm with supersede_agreement: true.`,code:'agreement_has_ledger',ledger_entries:latest.entries},409);
 const version=p.latest+1,vid=crypto.randomUUID(),token=secret(),now=new Date().toISOString();
 let result;
 // Advance `latest` first; the version row is inserted only if that succeeded (no orphan rows).
 try{result=await db().batch([db().prepare('UPDATE projects SET latest=?,link_issued=NULL WHERE id=? AND owner=? AND latest=?').bind(version,id,user,p.latest),db().prepare('INSERT INTO versions (id,project_id,version,token,content,status,created) SELECT ?,?,?,?,?,?,? WHERE EXISTS (SELECT 1 FROM projects WHERE id=? AND latest=?)').bind(vid,id,version,token,JSON.stringify(input.data),'pending',now,id,version)],{lock:lockKey('project',id)});}catch(e){if(String(e).includes('UNIQUE'))return json({error:'Another revision was saved. Refresh before retrying.'},409);throw e;}
 if(!result[0].meta.changes||!result[1].meta.changes)return json({error:'Another revision was saved. Refresh before retrying.'},409);
 const scope={id:vid,project_id:id,version,revoked:0,content:input.data,status:'pending',created:now,signer:null,comment:null,decided:null,sealed:false};
 return json({scope:session?{...scope,token}:scope,review_path:session?`/review/${token}`:null,...(session?{}:{review_link:LINK_HINT})},201);
}catch(e){return failure(e);}}

// Project metadata the owner can change without a new version: archive state and the
// client email used by "Send for signature". Nothing here touches signed content.
const patchSchema=z.object({archived:z.boolean().optional(),client_email:clientEmailSchema.optional(),timezone:z.union([z.literal(''),z.string().max(64).refine(validTimeZone,'Use an IANA time zone such as Asia/Kolkata')]).optional(),require_otp:z.boolean().optional(),link_expiry_days:z.union([z.null(),z.literal(7),z.literal(14),z.literal(30),z.literal(60),z.literal(90)]).optional(),client_phone:z.union([z.literal(''),z.string().regex(/^\+[1-9]\d{7,14}$/,'Enter the phone number in international form, e.g. +919876543210')]).optional(),otp_channel:z.enum(['email','sms','whatsapp']).optional(),cosigners:cosignersSchema.optional()}).strict().refine(x=>Object.values(x).some(v=>v!==undefined),'Provide at least one project setting.');
export async function PATCH(request:Request,ctx:Ctx){try{
 if(!safeOrigin(request))return json({error:'Origin not allowed.'},403);
 const auth=await ownerAuth(request);if(!auth)return json({error:'Sign in required.'},401);
 if(!auth.scopes.includes('scopes:write'))return json({error:'This credential cannot change projects.'},403);
 const {id}=await ctx.params;
 if(!await allowWrite('owner:'+auth.user))return json({error:'Write limit reached. Try again in a minute.'},429);
 let raw;try{raw=await body(request);}catch{return json({error:'Provide valid JSON under 24 KB.'},400);}
 const input=patchSchema.safeParse(raw);if(!input.success)return json({error:input.error.issues.map(i=>i.message).join('; ')},400);
 // PR B: requiring a code needs somewhere to send it (the client email, or the client phone for
 // SMS/WhatsApp) and a way to deliver it on that channel.
 const d=input.data;
 const current=await db().prepare('SELECT client_email,client_phone,otp_channel,require_otp FROM projects WHERE id=? AND owner=?').bind(id,auth.user).first<{client_email:string|null;client_phone:string|null;otp_channel:string|null;require_otp:boolean}>();
 if(!current)return json({error:'Project not found.'},404);
 const email=d.client_email!==undefined?d.client_email:(current.client_email??'');
 const phone=d.client_phone!==undefined?d.client_phone:(current.client_phone??'');
 const channel=(d.otp_channel??current.otp_channel??'email') as OtpChannel;
 const requireOtp=d.require_otp??current.require_otp;
 if(requireOtp&&channel==='email'&&!email)return json({error:'Add the client’s email first: the one-time code is sent there.',code:'otp_needs_email'},400);
 if(requireOtp&&channel!=='email'&&!phone)return json({error:'Add the client’s phone number first: the one-time code is sent there.',code:'otp_needs_phone'},400);
 if((d.require_otp===true||(requireOtp&&d.otp_channel!==undefined))&&!otpAvailable(process.env,channel))return json({error:channel==='email'?'Email delivery is not configured on this server, so a one-time code cannot be sent. Set RESEND_API_KEY and SCOPEFLOW_MAIL_FROM first.':`${channel==='whatsapp'?'WhatsApp':'SMS'} delivery is not configured on this server. Set up MSG91 or Twilio first.`,code:'otp_unavailable'},409);
 const now=new Date().toISOString();
 const sets:string[]=[],values:(string|number|boolean|null)[]=[];
 if(d.archived!==undefined){sets.push('archived=?');values.push(d.archived?now:null);}
 if(d.client_email!==undefined){sets.push('client_email=?');values.push(d.client_email||null);}
 if(d.timezone!==undefined){sets.push('timezone=?');values.push(d.timezone||null);}
 if(d.require_otp!==undefined){sets.push('require_otp=?');values.push(d.require_otp);}
 if(d.link_expiry_days!==undefined){sets.push('link_expiry_days=?');values.push(d.link_expiry_days);}
 if(d.client_phone!==undefined){sets.push('client_phone=?');values.push(d.client_phone||null);}
 if(d.otp_channel!==undefined){sets.push('otp_channel=?');values.push(d.otp_channel);}
 if(d.cosigners!==undefined){sets.push('cosigners=?');values.push(d.cosigners.length?JSON.stringify(d.cosigners):null);}
 const row=await db().prepare(`UPDATE projects SET ${sets.join(',')} WHERE id=? AND owner=? RETURNING ${PROJECT_COLUMNS}`).bind(...values,id,auth.user).first<ProjectRow>();
 if(!row)return json({error:'Project not found.'},404);
 return json({project:{id,...projectSettings(row)}});
}catch(e){return failure(e);}}

// Deleting one project. Signed client evidence must stay consistent with the SF-04
// triggers, so only projects with no client decision and no ledger entry can be deleted
// (drafts that were never decided). Anything a client approved or answered can only be
// archived; the database triggers enforce the same rule even under the bypass. Deletion
// is permanent and limited to the signed-in website owner, like account deletion.
export async function DELETE(request:Request,ctx:Ctx){try{
 if(!safeOrigin(request)||request.headers.get('sec-fetch-site')==='cross-site')return json({error:'Origin not allowed.'},403);
 if(request.headers.has('authorization'))return json({error:'Delete projects from the Scopeflow website.'},403);
 const user=await getUser();if(!user)return json({error:'Sign in to delete a project.'},401);
 const {id}=await ctx.params;
 let raw;try{raw=await body(request);}catch{return json({error:'Confirm deletion with JSON.'},400);}
 if(!z.object({confirmation:z.literal('DELETE')}).strict().safeParse(raw).success)return json({error:'Type DELETE to confirm permanent deletion.'},400);
 if(!await allowWrite('owner:'+user.userId))return json({error:'Write limit reached. Try again in a minute.'},429);
 const evidence=await db().prepare("SELECT (SELECT COUNT(*) FROM versions WHERE project_id=p.id AND status<>'pending') AS decided,(SELECT COUNT(*) FROM ledger_entries WHERE project_id=p.id) AS entries FROM projects p WHERE p.id=? AND p.owner=?").bind(id,user.userId).first<{decided:number;entries:number}>();
 if(!evidence)return json({error:'Project not found.'},404);
 const signed=()=>json({error:'This project has a client decision or ledger entry on record. Signed records cannot be deleted; archive the project instead.',code:'has_client_evidence'},409);
 if(evidence.decided>0||evidence.entries>0)return signed();
 const database=db();
 let result;
 try{result=await database.batch([
  // Lock every version row first: a client decision racing this delete either commits
  // before (and the checks below see it) or waits and then finds nothing to decide.
  database.prepare('SELECT id FROM versions WHERE project_id=? AND project_id IN (SELECT id FROM projects WHERE owner=?) FOR UPDATE').bind(id,user.userId),
  database.prepare("DELETE FROM rate_limits WHERE id IN (SELECT 'review:'||v.id FROM versions v JOIN projects p ON p.id=v.project_id WHERE p.id=? AND p.owner=?)").bind(id,user.userId),
  database.prepare("DELETE FROM versions WHERE project_id=? AND status='pending' AND EXISTS (SELECT 1 FROM projects WHERE id=? AND owner=?) AND NOT EXISTS (SELECT 1 FROM versions WHERE project_id=? AND status<>'pending') AND NOT EXISTS (SELECT 1 FROM ledger_entries WHERE project_id=?)").bind(id,id,user.userId,id,id),
  database.prepare('DELETE FROM projects WHERE id=? AND owner=? AND NOT EXISTS (SELECT 1 FROM versions WHERE project_id=?)').bind(id,user.userId,id),
  database.prepare('DELETE FROM review_views WHERE project_id=? AND NOT EXISTS (SELECT 1 FROM projects WHERE id=?)').bind(id,id),
 ],{lock:lockKey('project',id),bypassImmutability:'drafts'});}catch(e){if(String(e).includes('immutable')||String(e).includes('append-only'))return signed();throw e;}
 if(!result[3].meta.changes)return signed();
 console.warn('Scopeflow draft project deleted by its owner',JSON.stringify({owner_hash:(await hash(user.userId)).slice(0,16),versions:result[2].meta.changes,at:new Date().toISOString()}));
 return json({deleted:true,project_id:id});
}catch(e){return failure(e);}}
