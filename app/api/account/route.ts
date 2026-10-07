import {z} from 'zod';
import {appOrigin} from '@/lib/origin';
import {getUser} from '@/lib/auth/server';
import {db,json,body,failure,hash} from '@/lib/server';
import {lockKey} from '@/db/client';

// Account destruction is available only to the signed-in website user, never an API token.
async function browserUser(request:Request){
 if(request.headers.has('authorization'))return null;
 return getUser();
}
export async function GET(request:Request){try{
 const user=await browserUser(request);if(!user)return json({error:'Sign in to manage your Scopeflow data.'},401);
 const r=await db().prepare('SELECT (SELECT COUNT(*) FROM projects WHERE owner=?) AS projects, (SELECT COUNT(*) FROM versions WHERE project_id IN (SELECT id FROM projects WHERE owner=?)) AS versions, (SELECT COUNT(*) FROM ledger_entries WHERE project_id IN (SELECT id FROM projects WHERE owner=?)) AS ledger_entries').bind(user.userId,user.userId,user.userId).first();
 return json(r);
}catch(e){return failure(e);}}
export async function DELETE(request:Request){try{
 if(request.headers.get('origin')!==appOrigin(request)||request.headers.get('sec-fetch-site')==='cross-site')return json({error:'Delete your data from the Scopeflow website.'},403);
 const user=await browserUser(request);if(!user)return json({error:'Sign in to delete your Scopeflow data.'},401);
 if(request.headers.get('content-type')?.split(';')[0].trim().toLowerCase()!=='application/json')return json({error:'Confirm deletion with JSON.'},415);
 let raw;try{raw=await body(request);}catch{return json({error:'Provide a valid deletion confirmation.'},400);}
 if(!z.object({confirmation:z.literal('DELETE')}).strict().safeParse(raw).success)return json({error:'Type DELETE to confirm permanent deletion.'},400);
 const database=db(),id=user.userId;
 // Database batches are transactional. Resolve ownership in each statement; remove dependent rows first.
 await database.batch([
  database.prepare("DELETE FROM rate_limits WHERE id IN (?,?) OR id IN (SELECT 'review:'||v.id FROM versions v JOIN projects p ON p.id=v.project_id WHERE p.owner=?)").bind('owner:'+id,'key:'+id,id),
  database.prepare('DELETE FROM ledger_entries WHERE project_id IN (SELECT id FROM projects WHERE owner=?)').bind(id),
  database.prepare('DELETE FROM versions WHERE project_id IN (SELECT id FROM projects WHERE owner=?)').bind(id),
  database.prepare('DELETE FROM projects WHERE owner=?').bind(id),
  database.prepare('DELETE FROM api_keys WHERE owner=?').bind(id),
  database.prepare('DELETE FROM account_settings WHERE owner=?').bind(id),
  database.prepare('DELETE FROM oauth_codes WHERE owner=?').bind(id),
  database.prepare('DELETE FROM oauth_tokens WHERE owner=?').bind(id),
 ],{lock:lockKey('owner',id),bypassImmutability:true});
 // SF-04: the only path allowed past the immutability triggers; leave an audit line.
 console.warn('Scopeflow account data deleted by its owner',JSON.stringify({owner_hash:(await hash(id)).slice(0,16),at:new Date().toISOString()}));
 return json({deleted:true});
}catch{console.error('Scopeflow account deletion failed.');return json({error:'Deletion could not be completed. Please try again.'},503);}}
