import { scopeSchema } from '@/lib/scope';
import { lockKey } from '@/db/client';
import { db,json,ownerAuth,body,safeOrigin,allowWrite,allowRead,parseRow,secret,failure } from '@/lib/server';
type Ctx={params:Promise<{id:string}>};
const LINK_HINT='Review links are shown only in the signed-in Scopeflow workspace, so an API token or connector can never act as the client.';
export async function GET(request:Request,ctx:Ctx){try{const auth=await ownerAuth(request);if(!auth)return json({error:'Sign in required.'},401);if(!await allowRead('owner:'+auth.user))return json({error:'Too many requests. Try again in a minute.'},429);const {id}=await ctx.params;const p=await db().prepare('SELECT latest FROM projects WHERE id=? AND owner=?').bind(id,auth.user).first();if(!p)return json({error:'Project not found.'},404);const r=await db().prepare('SELECT * FROM versions WHERE project_id=? ORDER BY version DESC').bind(id).all();return json({versions:r.results.map(row=>parseRow(row,{withToken:auth.via==='session'}))});}catch(e){return failure(e);}}
export async function POST(request:Request,ctx:Ctx){try{
 if(!safeOrigin(request))return json({error:'Origin not allowed.'},403);const auth=await ownerAuth(request);if(!auth)return json({error:'Sign in required.'},401);const user=auth.user,session=auth.via==='session';const {id}=await ctx.params;
 const p=await db().prepare('SELECT latest FROM projects WHERE id=? AND owner=?').bind(id,user).first<{latest:number}>();if(!p)return json({error:'Project not found.'},404);
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
