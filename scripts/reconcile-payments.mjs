// Razorpay reconciliation (daily cron): asks the running app to record any captured payment whose
// webhook was lost and to append ledger entries that are missing (see
// app/api/payments/razorpay/reconcile/route.ts). Needs APP_URL and SCOPEFLOW_CRON_SECRET (the same
// value as the web service). Exits 0 with a note when they are not set, so the cron stays green.
import {postHttp1} from './post-http1.mjs';

const origin = process.env.APP_URL?.trim().replace(/\/$/, '');
const secret = process.env.SCOPEFLOW_CRON_SECRET?.trim();
if (!origin || !secret) { console.log(JSON.stringify({skipped: 'set APP_URL and SCOPEFLOW_CRON_SECRET to reconcile payments'})); process.exit(0); }
const response = await postHttp1(`${origin}/api/payments/razorpay/reconcile`, {headers: {Authorization: `Bearer ${secret}`}, timeoutMs: 180_000});
console.log(response.text.slice(0, 4000));
if (response.status < 200 || response.status >= 300) process.exit(1);
