import { z } from 'zod';
import { scopeSchema } from '@/lib/scope';
import { clientEmailSchema } from '@/lib/mail';
import { getUser } from '@/lib/auth/server';
import { lockKey } from '@/db/client';
import { db,json,ownerAuth,body,safeOrigin,allowWrite,allowRead,parseRow,secret,failure,hash } from '@/lib/server';
type Ctx={params:Promise<{id:string}>};
const LINK_HINT='Review links are shown only in the signed-in Scopeflow workspace, so an API token or connector can never act as the client.';
export async function GET(request:Request,ctx:Ctx){try{const auth=await ownerAuth(request);if(!auth)return json({error:'Sign in required.'},401);if(!await allowRead('owner:'+auth.user))return json({error:'Too many requests. Try again in a minute.'},429);const {id}=await ctx.params;const p=await db().prepare('SELECT latest,archived,client_email FROM projects WHERE id=? AND owner=?').bind(id,auth.user).first<{latest:number;archived:string|null;client_email:string|null}>();if(!p)return json({error:'Project not found.'},404);const r=await db().prepare('SELECT * FROM versions WHERE project_id=? ORDER BY version DESC').bind(id).all();return json({versions:r.results.map(row=>parseRow(row,{withToken:auth.via==='session'})),project:{archived:p.archived??null,client_email:p.client_email??''}});}catch(e){return failure(e);}}
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
 if(p.latest>=100)return json({error:'The beta supports up to 100 versions per project.'},429);
 // SF-06: a new version replaces the approved agreement, including approved change
 // orders and recorded rounds. Never do that silently.
 const latest=await db().prepare("SELECT v.status,(SELECT COUNT(*) FROM ledger_entries e WHERE e.project_id=v.project_id AND e.baseline_version=v.version) AS entries FROM versions v WHERE v.project_id=? AND v.version=?").bind(id,p.latest).first<{status:string;entries:number}>();
 if(latest?.status==='approved'&&latest.entries>0&&raw.supersede_agreement!==true)return json({error:`Version ${p.latest} is an approved agreement with ${latest.entries} ledger ${latest.entries===1?'entry':'entries'} (change orders, rounds or delays). A new version replaces that agreement once approved. Start the revision from the current agreement, then confirm with supersede_agreement: true.`,code:'agreement_has_ledger',ledger_entries:latest.entries},409);
 const version=p.latest+1,vid=crypto.randomUUID(),token=secret(),now=new Date().toISOString();
 let result;
 // Advance `latest` first; the version row is inserted only if that succeeded (no orphan rows).
 try{result=await db().batch([db().prepare('UPDATE projects SET latest=? WHERE id=? AND owner=? AND latest=?').bind(version,id,user,p.latest),db().prepare('INSERT INTO versions (id,project_id,version,token,content,status,created) SELECT ?,?,?,?,?,?,? WHERE EXISTS (SELECT 1 FROM projects WHERE id=? AND latest=?)').bind(vid,id,version,token,JSON.stringify(input.data),'pending',now,id,version)],{lock:lockKey('project',id)});}catch(e){if(String(e).includes('UNIQUE'))return json({error:'Another revision was saved. Refresh before retrying.'},409);throw e;}
 if(!result[0].meta.changes||!result[1].meta.changes)return json({error:'Another revision was saved. Refresh before retrying.'},409);
 const scope={id:vid,project_id:id,version,revoked:0,content:input.data,status:'pending',created:now,signer:null,comment:null,decided:null,sealed:false};
 return json({scope:session?{...scope,token}:scope,review_path:session?`/review/${token}`:null,...(session?{}:{review_link:LINK_HINT})},201);
}catch(e){return failure(e);}}

// Project metadata the owner can change without a new version: archive state and the
// client email used by "Send for signature". Nothing here touches signed content.
const patchSchema=z.object({archived:z.boolean().optional(),client_email:clientEmailSchema.optional()}).strict().refine(x=>x.archived!==undefined||x.client_email!==undefined,'Provide archived or client_email.');
export async function PATCH(request:Request,ctx:Ctx){try{
 if(!safeOrigin(request))return json({error:'Origin not allowed.'},403);
 const auth=await ownerAuth(request);if(!auth)return json({error:'Sign in required.'},401);
 if(!auth.scopes.includes('scopes:write'))return json({error:'This credential cannot change projects.'},403);
 const {id}=await ctx.params;
 if(!await allowWrite('owner:'+auth.user))return json({error:'Write limit reached. Try again in a minute.'},429);
 let raw;try{raw=await body(request);}catch{return json({error:'Provide valid JSON under 24 KB.'},400);}
 const input=patchSchema.safeParse(raw);if(!input.success)return json({error:input.error.issues.map(i=>i.message).join('; ')},400);
 const now=new Date().toISOString();
 const sets:string[]=[],values:(string|null)[]=[];
 if(input.data.archived!==undefined){sets.push('archived=?');values.push(input.data.archived?now:null);}
 if(input.data.client_email!==undefined){sets.push('client_email=?');values.push(input.data.client_email||null);}
 const row=await db().prepare(`UPDATE projects SET ${sets.join(',')} WHERE id=? AND owner=? RETURNING archived,client_email`).bind(...values,id,auth.user).first<{archived:string|null;client_email:string|null}>();
 if(!row)return json({error:'Project not found.'},404);
 return json({project:{id,archived:row.archived??null,client_email:row.client_email??''}});
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
 ],{lock:lockKey('project',id),bypassImmutability:'drafts'});}catch(e){if(String(e).includes('immutable')||String(e).includes('append-only'))return signed();throw e;}
 if(!result[3].meta.changes)return signed();
 console.warn('Scopeflow draft project deleted by its owner',JSON.stringify({owner_hash:(await hash(user.userId)).slice(0,16),versions:result[2].meta.changes,at:new Date().toISOString()}));
 return json({deleted:true,project_id:id});
}catch(e){return failure(e);}}
