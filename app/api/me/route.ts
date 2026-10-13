import {getUser} from '@/lib/auth/server';
import {db,json,accountKey} from '@/lib/server';
import {mailConfigured} from '@/lib/mail';
import {llmStatus} from '@/lib/llm';
import {otpAvailable,otpChannels} from '@/lib/otp';
import {isMode} from '@/lib/mode';
import {validTimeZone} from '@/lib/time';
import {planStateFor} from '@/lib/billing';
// `account`: an opaque per-account key (not the user id) so the browser keeps each account's unsaved
// draft separately and never restores one account's draft for another.
// `otp`: whether a one-time email code can be required before signing (PR B).
// `mail` tells the workspace whether "Send for signature" can email (RESEND_API_KEY + SCOPEFLOW_MAIL_FROM).
// `defaults` (WS-08, LT-04/SF-17/LT-16): the account's mode, default currency and time zone for new
// scopes (set at onboarding), whether onboarding is done, and the plan badge.
async function defaults(owner:string){
 const r=await db().prepare('SELECT s.mode,s.country,s.timezone,s.onboarded,b.default_currency FROM (SELECT ?::text AS owner) o LEFT JOIN account_settings s ON s.owner=o.owner LEFT JOIN business_profiles b ON b.owner=o.owner').bind(owner).first<{mode:string|null;country:string|null;timezone:string|null;onboarded:string|null;default_currency:string|null}>();
 const plan=await planStateFor(owner);
 return {mode:isMode(r?.mode)?r.mode:'freelancer',currency:r?.default_currency||'USD',currency_set:!!r?.default_currency,timezone:validTimeZone(r?.timezone)?r!.timezone:null,country:r?.country??null,onboarded:!!r?.onboarded,plan:{id:plan.plan.id,name:plan.plan.name,status:plan.status}};
}
export async function GET(){const user=await getUser();return json({signedIn:!!user,...(user?{account:await accountKey(user.userId),mail:mailConfigured(),ai:llmStatus(),otp:otpAvailable(),otp_channels:otpChannels(),defaults:await defaults(user.userId).catch(()=>null)}:{})});}
