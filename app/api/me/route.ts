import {getUser} from '@/lib/auth/server';
import {json} from '@/lib/server';
import {mailConfigured} from '@/lib/mail';
import {llmStatus} from '@/lib/llm';
import {otpAvailable,otpChannels} from '@/lib/otp';
// `otp`: whether a one-time email code can be required before signing (PR B).
// `mail` tells the workspace whether "Send for signature" can email (RESEND_API_KEY + SCOPEFLOW_MAIL_FROM).
export async function GET(){const user=await getUser();return json({signedIn:!!user,...(user?{mail:mailConfigured(),ai:llmStatus(),otp:otpAvailable(),otp_channels:otpChannels()}:{})});}
