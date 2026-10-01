import { scopeSchema } from '@/lib/scope';
import { db,json,owner,body,safeOrigin,allowWrite,parseRow,secret,hash,failure } from '@/lib/server';
export async function GET(request:Request){try{const user=await owner(request);if(!user)return json({error:'Sign in or provide a valid API token.'},401);const r=await db().prepare('SELECT v.* FROM versions v JOIN projects p ON p.id=v.project_id WHERE p.owner=? AND p.latest=v.version ORDER BY p.created DESC LIMIT 100').bind(user).all();return json({scopes:r.results.map(parseRow)});}catch(e){return failure(e);}}
export async function POST(request:Request){try{
 if(!safeOrigin(request))return json({error:'Origin not allowed.'},403);
 const user=await owner(request);if(!user)return json({error:'Sign in or provide a valid API token.'},401);
 if(!await allowWrite('owner:'+user))return json({error:'Write limit reached. Try again in a minute.'},429);
 let raw;try{raw=await body(request);}catch{return json({error:'Provide valid JSON under 24 KB.'},400);}
 const input=scopeSchema.safeParse(raw);if(!input.success)return json({error:input.error.issues.map(i=>`${i.path.join('.')}: ${i.message}`).join('; ')},400);
 const requestKey=request.headers.get('idempotency-key');
 if(requestKey&&!/^[A-Za-z0-9_-]{8,120}$/.test(requestKey))return json({error:'Use an 8–120 character idempotency key.'},400);
 const id=requestKey?'idem_'+await hash(user+':'+requestKey):crypto.randomUUID();
 async function existing(){const row=await db().prepare('SELECT v.* FROM versions v JOIN projects p ON p.id=v.project_id WHERE p.id=? AND p.owner=? AND v.version=1').bind(id,user).first<any>();if(!row)return null;const v=parseRow(row);return JSON.stringify(v.content)===JSON.stringify(input.data)?json({scope:v,review_path:v.revoked?null:'/review/'+v.token,replayed:true},200):json({error:'That idempotency key was already used with different content.'},409);}
 if(requestKey){const prior=await existing();if(prior)return prior;}
 const count=await db().prepare('SELECT COUNT(*) AS n FROM projects WHERE owner=?').bind(user).first<{n:number}>();if((count?.n??0)>=100)return json({error:'The early beta supports 100 projects per account.'},429);
 const vid=crypto.randomUUID(),token=secret(),now=new Date().toISOString();
 try{await db().batch([db().prepare('INSERT INTO projects (id,owner,latest,created) VALUES (?,?,1,?)').bind(id,user,now),db().prepare('INSERT INTO versions (id,project_id,version,token,content,status,created) VALUES (?,?,1,?,?,?,?)').bind(vid,id,token,JSON.stringify(input.data),'pending',now)]);}catch(e){if(requestKey&&String(e).includes('UNIQUE')){const prior=await existing();if(prior)return prior;}throw e;}
 return json({scope:{id:vid,project_id:id,version:1,token,revoked:0,content:input.data,status:'pending',created:now,signer:null,comment:null,decided:null},review_path:`/review/${token}`},201);
}catch(e){return failure(e);}}
