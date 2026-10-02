import { z } from 'zod';
import {db,json,body,safeOrigin,allowWrite,parseRow,failure} from '@/lib/server';
import {loadLedger} from '@/lib/ledger-server';
type Ctx={params:Promise<{token:string}>};
async function find(token:string){if(!/^[a-f0-9]{64}$/.test(token))return null;return db().prepare('SELECT v.*,p.latest FROM versions v JOIN projects p ON p.id=v.project_id WHERE v.token=? AND v.revoked=0').bind(token).first<any>();}
export async function GET(request:Request,ctx:Ctx){try{const {token}=await ctx.params;const row=await find(token);if(!row)return json({error:'This review link was not found.'},404);const previous=await db().prepare('SELECT content FROM versions WHERE project_id=? AND version=?').bind(row.project_id,row.version-1).first<{content:string}>();const {token:_,...scope}=parseRow(row);
 // The approved latest version doubles as the client's view of the post-approval ledger.
 let ledger=null;if(row.version===row.latest&&row.status==='approved'){const l=await loadLedger(row.project_id,{forClient:true});if(l.baseline?.id===row.id)ledger={entries:l.entries,agreement:l.agreement,anchors:l.anchors,head:l.head};}
 return json({scope,previous:previous?JSON.parse(previous.content):null,ledger});}catch(e){return failure(e);}}
export async function POST(request:Request,ctx:Ctx){try{
 if(!safeOrigin(request))return json({error:'Origin not allowed.'},403);const {token}=await ctx.params;const row=await find(token);if(!row)return json({error:'This review link was not found.'},404);
 if(!await allowWrite('review:'+row.id,10))return json({error:'Too many attempts. Try again in a minute.'},429);
 let raw;try{raw=await body(request);}catch{return json({error:'Provide valid JSON under 24 KB.'},400);}
 const input=z.object({decision:z.enum(['approved','changes_requested']),signer:z.string().trim().min(2).max(120),comment:z.string().trim().max(3000),version:z.number().int()}).strict().safeParse(raw);
 if(!input.success)return json({error:'Enter your name and a valid decision.'},400);
 if(input.data.decision==='changes_requested'&&!input.data.comment)return json({error:'Please describe the changes you need.'},400);
 if(input.data.version!==row.version)return json({error:'Version mismatch. Reload this review.'},409);
 const r=await db().prepare("UPDATE versions SET status=?,signer=?,comment=?,decided=? WHERE id=? AND token=? AND revoked=0 AND status='pending' AND version=(SELECT latest FROM projects WHERE id=versions.project_id)").bind(input.data.decision,input.data.signer,input.data.comment,new Date().toISOString(),row.id,token).run();
 if(!r.meta.changes)return json({error:'This version already has a decision or has been replaced. Ask the creator for the latest link.'},409);
 return json({status:input.data.decision});
}catch(e){return failure(e);}}
