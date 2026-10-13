import { getDatabase } from '@/db/client';
export {safeOrigin} from '@/lib/origin';
import { appOrigin, clientIpFrom, ipRateKey } from '@/lib/origin';
import { getUser } from '@/lib/auth/server';
import { limits } from '@/lib/plans';
import { errorResponse } from '@/lib/errors';
import { memoryLimiter } from '@/lib/rate-memory';
export function db(){return getDatabase();}
export function json(data:unknown,status=200,headers:Record<string,string>={}){return Response.json(data,{status,headers:{'Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff',...headers}});}
export async function hash(value:string){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))).map(x=>x.toString(16).padStart(2,'0')).join('');}
/** Opaque per-account key the browser sees (not the user id): it scopes unsaved drafts to one account. */
export async function accountKey(userId:string){return (await hash('draft:'+userId)).slice(0,24);}
export function secret(){return crypto.randomUUID().replaceAll('-','')+crypto.randomUUID().replaceAll('-','');}

/** How the caller proved who they are. Only browser sessions may see review-link secrets (SF-02). */
export type Auth={user:string;via:'session'|'api_token'|'oauth';scopes:string[]};
const ALL_SCOPES=['scopes:read','scopes:write'];
// Requests built by the MCP route for its internal calls carry the already-verified identity.
const internal=new WeakMap<Request,Auth>();
export function asInternal(request:Request,auth:Auth){internal.set(request,auth);return request;}
export function mcpResource(request:Request){return appOrigin(request)+'/mcp';}

/** Bearer credential from the Authorization header; the scheme is case-insensitive (RFC 6750). */
export function bearer(request:Request){const value=request.headers.get('authorization');if(value===null)return undefined;const match=/^bearer[ \t]+([A-Za-z0-9._~+/=-]+)\s*$/i.exec(value);return match?match[1]:null;}

export async function ownerAuth(request:Request,{oauth=false}:{oauth?:boolean}={}):Promise<Auth|null>{
 const known=internal.get(request);if(known)return known;
 const token=bearer(request);
 if(token===null)return null;
 if(token!==undefined){
  const now=new Date().toISOString();
  if(token.startsWith('sfo_')){
   // OAuth access tokens are audience-bound to the MCP resource and accepted only there.
   if(!oauth)return null;
   const row=await db().prepare("SELECT owner,scope,family FROM oauth_tokens WHERE hash = ? AND kind='access' AND expires > ? AND resource = ?").bind(await hash(token),now,mcpResource(request)).first<{owner:string;scope:string;family:string|null}>();
   if(!row)return null;
   // M24: "last used" for the connected-apps list, written at most once a minute per grant.
   if(row.family)void db().prepare('UPDATE scopeflow.oauth_grants SET last_used=? WHERE id=? AND (last_used IS NULL OR last_used < ?)').bind(now,row.family,new Date(Date.now()-60_000).toISOString()).run().catch(()=>{});
   return {user:row.owner,via:'oauth',scopes:row.scope.split(' ').filter(Boolean)};
  }
  const row=await db().prepare('SELECT owner FROM api_keys WHERE hash = ? AND expires > ?').bind(await hash(token),now).first<{owner:string}>();
  return row?{user:row.owner,via:'api_token',scopes:ALL_SCOPES}:null;
 }
 // M27: reads may use Neon Auth's signed session cookie cache (60 s); state-changing requests always
 // re-check the session with Neon so a revoked session cannot write.
 const read=request.method==='GET'||request.method==='HEAD';
 const user=(await getUser({fresh:!read}))?.userId;
 return user?{user,via:'session',scopes:ALL_SCOPES}:null;
}
export async function owner(request:Request){return (await ownerAuth(request))?.user??null;}

export async function body(request:Request){if(Number(request.headers.get('content-length')||0)>24000)throw new Error('Input too large');const reader=request.body?.getReader();if(!reader)throw new Error('Missing body');const chunks:Uint8Array[]=[];let total=0;while(true){const {done,value}=await reader.read();if(done)break;total+=value.byteLength;if(total>24000){await reader.cancel();throw new Error('Input too large');}chunks.push(value);}const bytes=new Uint8Array(total);let i=0;for(const chunk of chunks){bytes.set(chunk,i);i+=chunk.length;}return JSON.parse(new TextDecoder().decode(bytes));}

// SF-05/SF-13: the rate limiter is a single atomic upsert with no lock, and stale
// windows are purged opportunistically so the table no longer grows forever.
export async function allowWrite(subject:string,limit=limits().writes_per_minute){
 const windowId=Math.floor(Date.now()/60000);
 const r=await db().prepare('INSERT INTO rate_limits (id,window_id,hits) VALUES (?,?,1) ON CONFLICT(id) DO UPDATE SET hits=CASE WHEN rate_limits.window_id=excluded.window_id THEN rate_limits.hits+1 ELSE 1 END, window_id=excluded.window_id RETURNING hits').bind(subject,windowId).first<{hits:number}>();
 if(Math.random()<0.01)void db().prepare('DELETE FROM rate_limits WHERE window_id < ?').bind(windowId-2).run().catch(()=>{});
 return (r?.hits??limit+1)<=limit;
}
// M26: reads never write to the database. Each instance keeps a sliding one-minute window per key.
const readLimiterKey=Symbol.for('scopeflow.readLimiter');
const globals=globalThis as typeof globalThis&{[readLimiterKey]?:ReturnType<typeof memoryLimiter>};
export function readLimiter(){return globals[readLimiterKey]??=memoryLimiter();}
/** Read limit (SF-13); separate from writes, kept in memory (M26). */
export async function allowRead(subject:string,limit=limits().reads_per_minute){return readLimiter().allow('read:'+subject,limit);}
/** H3: the caller's address as established through the trusted proxies (lib/origin.ts), never the left-most X-Forwarded-For entry. */
export function clientIp(request:Request){return clientIpFrom(request.headers).slice(0,64);}
/** Rate-limit key for the caller's network address (IPv6 by /64); only a hash is stored. */
export async function ipKey(request:Request){const ip=clientIp(request);return (await hash(ip==='unknown'?ip:ipRateKey(ip))).slice(0,24);}

type Row=Record<string,unknown>&{content:string};
/** Version row for owner reads. Review tokens are returned only to browser sessions (SF-02). */
export function parseRow(row:Record<string,unknown>,{withToken=true}:{withToken?:boolean}={}){
 const {token,decision_context,signature,...rest}=row as Row&{token?:string;decision_context?:string|null;signature?:string|null};
 const parsed:Record<string,unknown>={...rest,content:JSON.parse(String(row.content)),sealed:!!signature};
 if(decision_context)try{parsed.decision_context=JSON.parse(decision_context);}catch{/* ignore */}
 if(withToken)parsed.token=token;
 return parsed;
}
/**
 * M28: the catch-all for route errors. Typed errors (lib/errors.ts) keep their status; bad stored
 * values are 400; races are 409; only a dependency outage is 503; anything else is a 500 with an
 * error id that is logged with the stack.
 */
export function failure(e:unknown){return errorResponse(e);}
