// Notifications cron (WS-06; every 5 minutes as its own Render cron, WS-10): asks the app to send
// queued client notices (change order proposed, invoice issued) and retry outbox mail. Needs APP_URL
// and SCOPEFLOW_CRON_SECRET. Prints one JSON line; exits 1 when the app refused or was unreachable.
const origin = process.env.APP_URL?.trim().replace(/\/$/, '');
const secret = process.env.SCOPEFLOW_CRON_SECRET?.trim();
if (!origin || !secret) { console.error('Set APP_URL and SCOPEFLOW_CRON_SECRET.'); process.exit(1); }
try {
  const r = await fetch(origin + '/api/notify/drain', {method: 'POST', headers: {Authorization: 'Bearer ' + secret}, signal: AbortSignal.timeout(60000)});
  const data = await r.json().catch(() => ({}));
  console.log(JSON.stringify({status: r.status, ...data}));
  if (!r.ok) process.exit(1);
} catch (e) { console.error(JSON.stringify({error: e instanceof Error ? e.message : 'unreachable'})); process.exit(1); }
