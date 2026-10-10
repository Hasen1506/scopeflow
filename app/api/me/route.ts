import {getUser} from '@/lib/auth/server';
import {json,hash} from '@/lib/server';
import {mailConfigured} from '@/lib/mail';
import {llmStatus} from '@/lib/llm';
import {otpAvailable,otpChannels} from '@/lib/otp';
// `account`: an opaque per-account key (not the user id) so the browser keeps each account's unsaved
// draft separately and never restores one account's draft for another.
// `otp`: whether a one-time email code can be required before signing (PR B).
// `mail` tells the workspace whether "Send for signature" can email (RESEND_API_KEY + SCOPEFLOW_MAIL_FROM).
export async function GET(){const user=await getUser();return json({signedIn:!!user,...(user?{account:(await hash('draft:'+user.userId)).slice(0,24),mail:mailConfigured(),ai:llmStatus(),otp:otpAvailable(),otp_channels:otpChannels()}:{})});}
