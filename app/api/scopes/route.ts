import { scopeSchema } from '@/lib/scope';
import { lockKey } from '@/db/client';
import { db,json,ownerAuth,body,safeOrigin,allowWrite,allowRead,parseRow,secret,hash,failure } from '@/lib/server';
const LINK_HINT='Review links are shown only in the signed-in Scopeflow workspace, so an API token or connector can never act as the client.';
export async function GET(request:Request){try{const auth=await ownerAuth(request);if(!auth)return json({error:'Sign in or provide a valid API token.'},401);if(!await allowRead('owner:'+auth.user))return json({error:'Too many requests. Try again in a minute.'},429);const r=await db().prepare('SELECT v.*,p.archived,p.client_email FROM versions v JOIN projects p ON p.id=v.project_id WHERE p.owner=? AND p.latest=v.version ORDER BY p.created DESC LIMIT 100').bind(auth.user).all();return json({scopes:r.results.map(row=>parseRow(row,{withToken:auth.via==='session'}))});}catch(e){return failure(e);}}
export async function POST(request:Request){try{
 if(!safeOrigin(request))return json({error:'Origin not allowed.'},403);
 const auth=await ownerAuth(request);if(!auth)return json({error:'Sign in or provide a valid API token.'},401);
 const user=auth.user,session=auth.via==='session';
 if(!await allowWrite('owner:'+user))return json({error:'Write limit reached. Try again in a minute.'},429);
 let raw;try{raw=await body(request);}catch{return json({error:'Provide valid JSON under 24 KB.'},400);}
 const input=scopeSchema.safeParse(raw);if(!input.success)return json({error:input.error.issues.map(i=>`${i.path.join('.')}: ${i.message}`).join('; ')},400);
 const requestKey=request.headers.get('idempotency-key');
 if(requestKey&&!/^[A-Za-z0-9_-]{8,120}$/.test(requestKey))return json({error:'Use an 8–120 character idempotency key.'},400);
 const id=requestKey?'idem_'+await hash(user+':'+requestKey):crypto.randomUUID();
 const reply=(scope:Record<string,unknown>,token:string,revoked:boolean,status:number,extra:Record<string,unknown>={})=>json({scope:session?{...scope,token}:scope,review_path:session&&!revoked?'/review/'+token:null,...(session?{}:{review_link:LINK_HINT}),...extra},status);
 async function existing(){const row=await db().prepare('SELECT v.* FROM versions v JOIN projects p ON p.id=v.project_id WHERE p.id=? AND p.owner=? AND v.version=1').bind(id,user).first<Record<string,unknown>&{token:string;revoked:number}>();if(!row)return null;const v=parseRow(row,{withToken:false});return JSON.stringify(v.content)===JSON.stringify(input.data)?reply(v,row.token,!!row.revoked,200,{replayed:true}):json({error:'That idempotency key was already used with different content.'},409);}
 if(requestKey){const prior=await existing();if(prior)return prior;}
 const vid=crypto.randomUUID(),token=secret(),now=new Date().toISOString();
 let created;
 // SF-09: the 100-project cap is checked inside the insert, serialized per owner.
 try{created=await db().batch([
  db().prepare('INSERT INTO projects (id,owner,latest,created) SELECT ?,?,1,? WHERE (SELECT COUNT(*) FROM projects WHERE owner=?) < 100').bind(id,user,now,user),
  db().prepare('INSERT INTO versions (id,project_id,version,token,content,status,created) SELECT ?,?,1,?,?,?,? WHERE EXISTS (SELECT 1 FROM projects WHERE id=? AND owner=?)').bind(vid,id,token,JSON.stringify(input.data),'pending',now,id,user),
 ],{lock:lockKey('owner',user)});}catch(e){if(requestKey&&String(e).includes('UNIQUE')){const prior=await existing();if(prior)return prior;}throw e;}
 if(!created[0].meta.changes)return json({error:'The early beta supports 100 projects per account.'},429);
 return reply({id:vid,project_id:id,version:1,revoked:0,content:input.data,status:'pending',created:now,signer:null,comment:null,decided:null,sealed:false},token,false,201);
}catch(e){return failure(e);}}
