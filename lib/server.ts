import { env } from 'cloudflare:workers';
import { getChatGPTUser } from '@/app/chatgpt-auth';
export function db(){if(!env.DB)throw new Error('Storage is unavailable');return env.DB;}
export function json(data:unknown,status=200){return Response.json(data,{status,headers:{'Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff'}});}
export async function hash(value:string){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))).map(x=>x.toString(16).padStart(2,'0')).join('');}
export function secret(){return crypto.randomUUID().replaceAll('-','')+crypto.randomUUID().replaceAll('-','');}
export async function owner(request:Request){
 const auth=request.headers.get('authorization');
 if(auth){if(!auth.startsWith('Bearer '))return null;const row=await db().prepare('SELECT owner FROM api_keys WHERE hash = ? AND expires > ?').bind(await hash(auth.slice(7)),new Date().toISOString()).first<{owner:string}>();return row?.owner??null;}
 return (await getChatGPTUser())?.userId??null;
}
export function safeOrigin(request:Request){const origin=request.headers.get('origin');return !origin||origin===new URL(request.url).origin;}
export async function body(request:Request){if(Number(request.headers.get('content-length')||0)>24000)throw new Error('Input too large');const reader=request.body?.getReader();if(!reader)throw new Error('Missing body');const chunks:Uint8Array[]=[];let total=0;while(true){const {done,value}=await reader.read();if(done)break;total+=value.byteLength;if(total>24000){await reader.cancel();throw new Error('Input too large');}chunks.push(value);}const bytes=new Uint8Array(total);let i=0;for(const chunk of chunks){bytes.set(chunk,i);i+=chunk.length;}return JSON.parse(new TextDecoder().decode(bytes));}
export async function allowWrite(subject:string,limit=30){const window=Math.floor(Date.now()/60000);const r=await db().prepare('INSERT INTO rate_limits (id,window,hits) VALUES (?,?,1) ON CONFLICT(id) DO UPDATE SET hits=CASE WHEN rate_limits.window=excluded.window THEN rate_limits.hits+1 ELSE 1 END, window=excluded.window RETURNING hits').bind(subject,window).first<{hits:number}>();return (r?.hits??limit+1)<=limit;}
export function parseRow(row:any){return {...row,content:JSON.parse(row.content)};}
export function failure(e:unknown){console.error('Scopeflow request failed',e instanceof Error?e.message:'unknown');return json({error:'Unable to complete this request. Your input is preserved; please try again.'},503);}
