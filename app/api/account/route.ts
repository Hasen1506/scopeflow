import {z} from 'zod';
import {getChatGPTUser} from '@/app/chatgpt-auth';
import {db,json,body,failure} from '@/lib/server';

// Account destruction is available only to the signed-in website user, never an API token.
async function browserUser(request:Request){
 if(request.headers.has('authorization'))return null;
 return getChatGPTUser();
}
export async function GET(request:Request){try{
 const user=await browserUser(request);if(!user)return json({error:'Sign in to manage your Scopeflow data.'},401);
 const r=await db().prepare('SELECT (SELECT COUNT(*) FROM projects WHERE owner=?) AS projects, (SELECT COUNT(*) FROM versions WHERE project_id IN (SELECT id FROM projects WHERE owner=?)) AS versions').bind(user.userId,user.userId).first();
 return json(r);
}catch(e){return failure(e);}}
export async function DELETE(request:Request){try{
 if(request.headers.get('origin')!==new URL(request.url).origin||request.headers.get('sec-fetch-site')==='cross-site')return json({error:'Delete your data from the Scopeflow website.'},403);
 const user=await browserUser(request);if(!user)return json({error:'Sign in to delete your Scopeflow data.'},401);
 if(request.headers.get('content-type')?.split(';')[0].trim().toLowerCase()!=='application/json')return json({error:'Confirm deletion with JSON.'},415);
 let raw;try{raw=await body(request);}catch{return json({error:'Provide a valid deletion confirmation.'},400);}
 if(!z.object({confirmation:z.literal('DELETE')}).strict().safeParse(raw).success)return json({error:'Type DELETE to confirm permanent deletion.'},400);
 const database=db(),id=user.userId;
 // D1 batches are transactional. Resolve ownership in each statement; remove dependent rows first.
 await database.batch([
  database.prepare("DELETE FROM rate_limits WHERE id IN (?,?) OR id IN (SELECT 'review:'||v.id FROM versions v JOIN projects p ON p.id=v.project_id WHERE p.owner=?)").bind('owner:'+id,'key:'+id,id),
  database.prepare('DELETE FROM versions WHERE project_id IN (SELECT id FROM projects WHERE owner=?)').bind(id),
  database.prepare('DELETE FROM projects WHERE owner=?').bind(id),
  database.prepare('DELETE FROM api_keys WHERE owner=?').bind(id),
 ]);
 return json({deleted:true});
}catch{console.error('Scopeflow account deletion failed.');return json({error:'Deletion could not be completed. Please try again.'},503);}}
