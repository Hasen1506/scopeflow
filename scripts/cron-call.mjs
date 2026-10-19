// Cron jobs that run inside the web service (scripts/cron.mjs): POSTs to the app with the operator
// token (SCOPEFLOW_ADMIN_TOKEN, else SCOPEFLOW_CRON_SECRET) and exits non-zero on failure.
//   heads         publish yesterday's signed ledger-head digest (C7)          POST /api/heads/<date>
//   analytics     export analytics events to PostHog when configured (SF-14)  POST /api/analytics/export
//   housekeeping  purge expired idempotency keys, OAuth codes, old cron runs  POST /api/readiness/housekeeping
import {postHttp1} from './post-http1.mjs';

const job = process.argv[2];
const origin = process.env.APP_URL?.trim().replace(/\/$/, '');
const token = process.env.SCOPEFLOW_ADMIN_TOKEN?.trim() || process.env.SCOPEFLOW_CRON_SECRET?.trim();
if (!origin || !token) { console.error(`Set APP_URL and SCOPEFLOW_CRON_SECRET to run the ${job} job.`); process.exit(1); }
const yesterday = new Date(Date.now() - 86400_000).toISOString().slice(0, 10);
const paths = {heads: `/api/heads/${yesterday}`, analytics: '/api/analytics/export', housekeeping: '/api/readiness/housekeeping'};
if (!paths[job]) { console.error('Unknown job ' + job); process.exit(2); }
const response = await postHttp1(origin + paths[job], {headers: {Authorization: `Bearer ${token}`}, timeoutMs: 180_000});
console.log(response.text.slice(0, 2000));
if (response.status < 200 || response.status >= 300) process.exit(1);
