// Razorpay reconciliation (daily cron): asks the running app to record any captured payment whose
// webhook was lost and to append ledger entries that are missing (see
// app/api/payments/razorpay/reconcile/route.ts). Needs APP_URL and SCOPEFLOW_CRON_SECRET (the same
// value as the web service). Exits 0 with a note when they are not set, so the cron stays green.
const origin = process.env.APP_URL?.trim().replace(/\/$/, '');
const secret = process.env.SCOPEFLOW_CRON_SECRET?.trim();
if (!origin || !secret) { console.log(JSON.stringify({skipped: 'set APP_URL and SCOPEFLOW_CRON_SECRET to reconcile payments'})); process.exit(0); }
const response = await fetch(`${origin}/api/payments/razorpay/reconcile`, {method: 'POST', headers: {Authorization: `Bearer ${secret}`}, signal: AbortSignal.timeout(120_000)});
const body = await response.text();
console.log(body.slice(0, 4000));
if (!response.ok) process.exit(1);
