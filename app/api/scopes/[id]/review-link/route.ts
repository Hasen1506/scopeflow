import {z} from 'zod';
import {getUser} from '@/lib/auth/server';
import {db,json,body,safeOrigin,allowWrite,secret,failure} from '@/lib/server';
type Ctx={params:Promise<{id:string}>};
export async function POST(request:Request,ctx:Ctx){try{
 if(!safeOrigin(request))return json({error:'Origin not allowed.'},403);
 const user=await getUser();if(!user)return json({error:'Sign in to manage review links.'},401);
 const {id}=await ctx.params;
 const project=await db().prepare('SELECT id FROM projects WHERE id=? AND owner=?').bind(id,user.userId).first();if(!project)return json({error:'Project not found.'},404);
 const data=z.object({version:z.number().int().min(1),action:z.enum(['revoke','rotate'])}).strict().safeParse(await body(request));
 if(!data.success)return json({error:'Choose a version and link action.'},400);
 if(!await allowWrite('owner:'+user.userId))return json({error:'Try again in a minute.'},429);
 const token=secret();
 const result=data.data.action==='revoke'
  ?await db().prepare('UPDATE versions SET revoked=1 WHERE project_id=? AND version=?').bind(id,data.data.version).run()
  :await db().prepare('UPDATE versions SET token=?,revoked=0 WHERE project_id=? AND version=?').bind(token,id,data.data.version).run();
 if(!result.meta.changes)return json({error:'Version not found.'},404);
 return json({revoked:data.data.action==='revoke',...(data.data.action==='rotate'?{review_path:'/review/'+token}:{})});
}catch(e){if(e instanceof SyntaxError||e instanceof Error&&/Input too large|Missing body/.test(e.message))return json({error:'Provide valid JSON under 24 KB.'},400);return failure(e);}}
