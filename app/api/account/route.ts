import {z} from 'zod';
import {appOrigin} from '@/lib/origin';
import {getAuth, getUser} from '@/lib/auth/server';
import {db,json,body,hash} from '@/lib/server';
import {closeAccountQuery, retainUntil, tombstoneRetentionYears} from '@/lib/retention-sql';
import {cancelSubscription} from '@/lib/billing';

// Account destruction is available only to the signed-in website user, never an API token.
async function browserUser(request:Request){
 if(request.headers.has('authorization'))return null;
 return getUser();
}
export async function GET(request:Request){try{
 const user=await browserUser(request);if(!user)return json({error:'Sign in to manage your Scopeflow data.'},401);
 // H10: projects of an earlier, closed account (kept for clients) are not this account's anymore.
 const r=await db().prepare('SELECT (SELECT COUNT(*) FROM projects WHERE owner=? AND owner_deleted IS NULL) AS projects, (SELECT COUNT(*) FROM versions WHERE project_id IN (SELECT id FROM projects WHERE owner=? AND owner_deleted IS NULL)) AS versions, (SELECT COUNT(*) FROM ledger_entries WHERE project_id IN (SELECT id FROM projects WHERE owner=? AND owner_deleted IS NULL)) AS ledger_entries').bind(user.userId,user.userId,user.userId).first();
 return json(r);
}catch{return json({error:'Unable to complete this request. Please try again.'},503);}}

/**
 * H10/LT-22: deleting an account keeps the client's record. The owner's own data goes (profile,
 * settings, templates, drafts, tokens, forwarded emails, unsent versions, projects without client
 * evidence); projects with a client decision, ledger entry, invoice or payment are tombstoned and
 * stay readable through their client links, read-only, for the retention period (default 8
 * years, the GST record period; CA to confirm). Then the Neon Auth login is deleted; when the
 * sign-in service refuses, the reply says the login remains (login_deleted: false).
 */
export async function DELETE(request:Request){try{
 if(request.headers.get('origin')!==appOrigin(request)||request.headers.get('sec-fetch-site')==='cross-site')return json({error:'Delete your data from the Scopeflow website.'},403);
 const user=await browserUser(request);if(!user)return json({error:'Sign in to delete your Scopeflow data.'},401);
 if(request.headers.get('content-type')?.split(';')[0].trim().toLowerCase()!=='application/json')return json({error:'Confirm deletion with JSON.'},415);
 let raw;try{raw=await body(request);}catch{return json({error:'Provide a valid deletion confirmation.'},400);}
 if(!z.object({confirmation:z.literal('DELETE')}).strict().safeParse(raw).success)return json({error:'Type DELETE to confirm permanent deletion.'},400);
 const database=db(),id=user.userId;
 const held=await database.prepare('SELECT COUNT(*) AS n FROM projects WHERE owner=? AND legal_hold').bind(id).first<{n:number}>();
 if(Number(held?.n)>0)return json({error:`${held!.n} project${Number(held!.n)===1?' is':'s are'} on legal hold. Lift the hold (in the project’s Retention settings) before deleting your account.`,code:'legal_hold'},409);
 if(!await cancelSubscription(id))return json({error:'Your ScopeFlow subscription could not be cancelled, so nothing was deleted. Try again in a minute or contact support.',code:'subscription_cancel_failed'},503);
 const now=new Date().toISOString(),until=retainUntil(now,tombstoneRetentionYears(process.env));
 // One SECURITY DEFINER call (migration 0022a) does the whole closure in one transaction under the
 // owner lock; the app never sets the deletion bypass itself (WS-10 C7).
 const [closeSql,closeParams]=closeAccountQuery(id,now,until);
 let kept:number;
 try{kept=Number((await database.prepare(closeSql).bind(...closeParams).first<{projects_kept:number}>())?.projects_kept??0);}
 catch(e){if(String(e).includes('legal hold'))return json({error:'A project was put on legal hold. Lift the hold before deleting your account.',code:'legal_hold'},409);throw e;}
 // LT-22: remove the login too. Neon Auth (Better Auth) deletes the signed-in user when its
 // delete-user endpoint is enabled; otherwise the login stays and we say so.
 let loginDeleted=false;
 try{const r=await getAuth().deleteUser({});loginDeleted=!r.error;}catch{loginDeleted=false;}
 if(loginDeleted)await database.prepare('UPDATE owner_tombstones SET login_deleted=true WHERE owner=?').bind(id).run().catch(()=>{});
 // SF-04: the only path allowed past the immutability triggers; leave an audit line.
 console.warn('Scopeflow account closed by its owner',JSON.stringify({owner_hash:(await hash(id)).slice(0,16),projects_kept:kept,login_deleted:loginDeleted,at:now}));
 return json({deleted:true,projects_kept:kept,kept_until:kept?until:null,login_deleted:loginDeleted,
  message:(kept?`${kept} project${kept===1?' with a client decision, payment or invoice is':'s with client decisions, payments or invoices are'} kept read-only for your clients until ${until.slice(0,10)}, then deleted. `:'')+(loginDeleted?'Your login was deleted too.':'Your login stays active: you can sign in and start fresh, or contact support to remove it.')});
}catch{console.error('Scopeflow account deletion failed.');return json({error:'Deletion could not be completed. Please try again.'},503);}}
