import { scopeSchema } from '@/lib/scope';
import { db,json,owner,body,safeOrigin,allowWrite,parseRow,secret,failure } from '@/lib/server';
type Ctx={params:Promise<{id:string}>};
export async function GET(request:Request,ctx:Ctx){try{const user=await owner(request);if(!user)return json({error:'Sign in required.'},401);const {id}=await ctx.params;const p=await db().prepare('SELECT latest FROM projects WHERE id=? AND owner=?').bind(id,user).first();if(!p)return json({error:'Project not found.'},404);const r=await db().prepare('SELECT * FROM versions WHERE project_id=? ORDER BY version DESC').bind(id).all();return json({versions:r.results.map(parseRow)});}catch(e){return failure(e);}}
export async function POST(request:Request,ctx:Ctx){try{
 if(!safeOrigin(request))return json({error:'Origin not allowed.'},403);const user=await owner(request);if(!user)return json({error:'Sign in required.'},401);const {id}=await ctx.params;
 const p=await db().prepare('SELECT latest FROM projects WHERE id=? AND owner=?').bind(id,user).first<{latest:number}>();if(!p)return json({error:'Project not found.'},404);
 if(!await allowWrite('owner:'+user))return json({error:'Write limit reached. Try again in a minute.'},429);
 let raw;try{raw=await body(request);}catch{return json({error:'Provide valid JSON under 24 KB.'},400);}
 if(!raw||typeof raw!=='object'||Array.isArray(raw))return json({error:'Provide a revision object.'},400);
 if(raw.expected_version!==p.latest)return json({error:'A newer version exists. Refresh the project before revising.'},409);
 const input=scopeSchema.safeParse(raw.content);if(!input.success)return json({error:input.error.issues.map(i=>`${i.path.join('.')}: ${i.message}`).join('; ')},400);
 if(p.latest>=100)return json({error:'The beta supports up to 100 versions per project.'},429);
 const version=p.latest+1,vid=crypto.randomUUID(),token=secret(),now=new Date().toISOString();
 try{await db().batch([db().prepare('INSERT INTO versions (id,project_id,version,token,content,status,created) VALUES (?,?,?,?,?,?,?)').bind(vid,id,version,token,JSON.stringify(input.data),'pending',now),db().prepare('UPDATE projects SET latest=? WHERE id=? AND owner=? AND latest=?').bind(version,id,user,p.latest)]);}catch(e){if(String(e).includes('UNIQUE'))return json({error:'Another revision was saved. Refresh before retrying.'},409);throw e;}
 return json({scope:{id:vid,project_id:id,version,token,content:input.data,status:'pending',created:now,signer:null,comment:null,decided:null},review_path:`/review/${token}`},201);
}catch(e){return failure(e);}}
