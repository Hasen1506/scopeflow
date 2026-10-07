import {getUser} from '@/lib/auth/server';
import {json} from '@/lib/server';
import {mailConfigured} from '@/lib/mail';
// `mail` tells the workspace whether "Send for signature" can email (RESEND_API_KEY + SCOPEFLOW_MAIL_FROM).
export async function GET(){const user=await getUser();return json({signedIn:!!user,...(user?{mail:mailConfigured()}:{})});}
