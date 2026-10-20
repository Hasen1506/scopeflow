// Automatic reminders (suitable for the daily cron, after redact-expired.mjs). For every owner who
// turned on "Remind clients automatically" (business_profiles.auto_remind_days), emails a reminder
// for each latest version still awaiting a decision once it has waited that many days since it was
// saved or last emailed. Same limits as the manual button (lib/mail.ts): at most one email a day
// and three reminders per version; archived projects, revoked links and projects without a client
// email are skipped. Needs DATABASE_URL, APP_URL, SCOPEFLOW_MAIL_FROM and a mail provider.
//
// Then, for the same owners, payment reminders for overdue invoices (Net-X): an invoice past its
// due date that the payments on the record do not cover gets a reminder on the day after it falls
// due and then every auto_remind_days, at most three in all (scopeflow.invoice_reminders).
// `--dry-run` lists what would be sent and changes nothing.
//
// WS-06: reminders are `bulk` mail (lib/mail-router.ts: SES first, then Resend; SCOPEFLOW_MAIL_ROUTES)
// with failover, a List-Unsubscribe header (one click stops reminders only), the shared suppression
// list (bounces, complaints, unsubscribes) and the per-recipient daily cap; each one is a row in
// scopeflow.mail_outbox. An invoice's expected TDS is never chased: an invoice whose open amount is
// no more than its TDS (paid net of TDS, awaiting the certificate) gets no payment reminder, and the
// amount in a reminder excludes the TDS portion. Instead, such an invoice gets a TDS-certificate
// (Form 16A) reminder at most once a quarter once the certificate is due, four at most
// (lib/reminder-rules.ts; WS-03 owns the statuses, this reads the invoice snapshot's `tds` and, when
// present, scopeflow.tds_credits). Projects whose owner deleted their account (tombstoned,
// projects.owner_deleted, WS-08) and projects with client notices switched off (notify_client) get
// no reminders.
import {registerHooks} from 'node:module';
// lib/*.ts use extensionless relative imports; resolve them to .ts files.
registerHooks({resolve(specifier, context, next) {
  if (/^\.{1,2}\//.test(specifier) && !/\.[cm]?[jt]s$/.test(specifier)) { try { return next(specifier + '.ts', context); } catch { /* fall through */ } }
  return next(specifier, context);
}});
const {createConnection} = await import('../db/connection.mjs');
const {autoReminderDue, brandEmail, invoiceReminderEmail, reminderEmail, unsubscribeHeaders} = await import('../lib/mail.ts');
const {providerConfigs, routeFor, routeMail, parseRoutes} = await import('../lib/mail-router.ts');
const {unsubscribeUrl} = await import('../lib/unsubscribe.ts');
const {invoiceReminderDue, invoiceStatuses} = await import('../lib/invoice-status.ts');
const {invoicePlan, tdsCertificateReminderKey, tdsExpected, tdsQuarterOf} = await import('../lib/reminder-rules.ts');
const {tdsCertificateEmail} = await import('../lib/mail.ts');

const dryRun = process.argv.includes('--dry-run');
const origin = process.env.APP_URL?.trim().replace(/\/$/, '');
if (!origin) { console.error('Set APP_URL to the public origin so reminders can link to the review page.'); process.exit(1); }
const configs = providerConfigs();
if (!routeFor('bulk', process.env, configs).length && !dryRun) { console.log(JSON.stringify({sent: 0, skipped: 'email delivery is not configured'})); process.exit(0); }
const PER_RECIPIENT = Number(process.env.SCOPEFLOW_LIMIT_MAIL_PER_RECIPIENT) || 3;
/** One bulk email through the outbox and the mail router. Returns true when a provider accepted it. */
async function sendBulk(sql, {owner, project_id, event, to, message, dedupe, fromName, replyTo}) {
  const rcpt = to.trim().toLowerCase();
  const [sup] = await sql`SELECT reason FROM scopeflow.mail_suppressions WHERE address = ${rcpt}`;
  if (sup) { console.error(JSON.stringify({project_id, skipped: 'suppressed', reason: sup.reason})); return false; }
  // D8: a rolling 24 hours, not since UTC midnight (05:30 IST), so the cap cannot reset mid-morning.
  const since = new Date(Date.now() - 86400_000).toISOString();
  const [count] = await sql`SELECT COUNT(*)::int AS n FROM scopeflow.mail_outbox WHERE owner = ${owner} AND recipient = ${rcpt} AND class <> 'auth' AND created >= ${since} AND status IN ('queued','sent','dev_log','failed')`;
  if (count.n >= PER_RECIPIENT) { console.error(JSON.stringify({project_id, skipped: 'recipient_cap'})); return false; }
  const id = crypto.randomUUID();
  const headers = unsubscribeHeaders(unsubscribeUrl(rcpt, origin));
  const [row] = await sql`INSERT INTO scopeflow.mail_outbox (id, owner, project_id, event, class, recipient, recipient_domain, subject, body_text, body_html, headers, from_name, reply_to, dedupe_key, status, created)
    VALUES (${id}, ${owner}, ${project_id}, ${event}, 'bulk', ${rcpt}, ${rcpt.split('@')[1] ?? ''}, ${message.subject}, ${message.text}, ${message.html}, ${JSON.stringify(headers)}, ${fromName ?? null}, ${replyTo ?? null}, ${dedupe}, 'queued', ${new Date().toISOString()})
    ON CONFLICT DO NOTHING RETURNING id`;
  if (!row) return false;
  const result = await routeMail({cls: 'bulk', to: rcpt, message, configs, routes: parseRoutes(process.env.SCOPEFLOW_MAIL_ROUTES), idempotencyKey: `scopeflow-outbox-${id}`, fromName, replyTo, headers});
  const status = result.status === 'sent' ? 'sent' : result.status === 'refused' ? 'refused' : 'failed';
  await sql`UPDATE scopeflow.mail_outbox SET status = ${status}, provider = ${result.provider}, provider_message_id = ${result.id}, last_error = ${result.status === 'sent' ? null : result.error}, attempts = 1, sent = ${status === 'sent' ? new Date().toISOString() : null} WHERE id = ${id}`;
  if (status !== 'sent') console.error(JSON.stringify({project_id, error: result.status === 'sent' ? null : result.error}));
  return status === 'sent';
}
/** The owner's brand for the email header (lib/mail.ts brandEmail), from the business profile columns. */
const brandOf = r => (r.brand_color || r.logo_hash) ? {name: r.business_name ?? '', color: r.brand_color, logoUrl: r.logo_hash ? `${origin}/api/brand/${r.logo_hash}` : null} : null;
const sql = createConnection();
try {
  const cols = new Set((await sql`SELECT column_name FROM information_schema.columns WHERE table_schema = 'scopeflow' AND table_name = 'projects' AND column_name IN ('owner_deleted', 'notify_client')`).map(r => r.column_name));
  // WS-08 tombstones: a project whose owner deleted their account is read-only and never chased.
  // (Fixed SQL text only: db/connection.mjs's tagged template binds values, it has no fragments.)
  const live = cols.has('owner_deleted') ? ' AND p.owner_deleted IS NULL' : '';
  const noticesOn = cols.has('notify_client') ? ' AND p.notify_client' : '';
  const rows = await sql.unsafe(`SELECT p.id, p.owner, p.client_email, p.last_sent, p.sent_version, p.reminders, v.version, v.token, v.content, v.created, b.auto_remind_days, b.business_name, b.brand_color, b.logo_hash, b.reply_to, COALESCE(oc.email_verified, false) AS verified, oc.email AS owner_email
    FROM scopeflow.projects p JOIN scopeflow.versions v ON v.project_id = p.id AND v.version = p.latest
    JOIN scopeflow.business_profiles b ON b.owner = p.owner LEFT JOIN scopeflow.owner_contacts oc ON oc.owner = p.owner
    WHERE b.auto_remind_days IS NOT NULL AND p.archived IS NULL AND v.status = 'pending' AND v.revoked = 0 AND p.client_email IS NOT NULL${live}${noticesOn}`);
  const now = Date.now();
  const {due: invoiceDue, certificates} = await overdueInvoices(sql, now, live + noticesOn);
  const due = rows.filter(r => autoReminderDue({last_sent: r.last_sent, sent_version: r.sent_version, reminders: r.reminders, version: r.version, created: r.created, auto_days: r.auto_remind_days}, now));
  if (dryRun) { console.log(JSON.stringify({dry_run: true, due: due.map(r => ({project_id: r.id, version: r.version, to: r.client_email})), invoices: invoiceDue.map(i => ({project_id: i.project_id, number: i.number, to: i.client_email, days_overdue: i.days_overdue})), tds_certificates: certificates.map(i => ({project_id: i.project_id, number: i.number, to: i.client_email, quarter: i.quarter}))})); process.exit(0); }
  let sent = 0, failed = 0;
  for (const r of due) {
    const content = JSON.parse(r.content);
    const message = brandEmail(reminderEmail({title: content.title, client: content.client, version: r.version, reviewUrl: `${origin}/review/${r.token}`, days: Math.floor((now - Date.parse(r.created)) / 86400_000)}), brandOf(r));
    try {
      const ok = await sendBulk(sql, {owner: r.owner, project_id: r.id, event: 'scope_reminder', to: r.client_email, message, dedupe: `scopeflow-auto-remind-${r.id}-${r.version}-${(r.reminders ?? 0) + 1}`, fromName: r.verified ? r.business_name : null, replyTo: r.reply_to || (r.verified ? r.owner_email : null)});
      if (!ok) { failed++; continue; }
      // Same bookkeeping as the manual reminder; the WHERE clause keeps a concurrent manual send from being double counted.
      await sql`UPDATE scopeflow.projects SET last_sent = ${new Date().toISOString()}, reminders = CASE WHEN sent_version = ${r.version} THEN reminders + 1 ELSE 1 END, sent_version = ${r.version}
        WHERE id = ${r.id} AND last_sent IS NOT DISTINCT FROM ${r.last_sent}`;
      sent++;
    } catch (e) {
      failed++;
      console.error(JSON.stringify({project_id: r.id, error: e instanceof Error ? e.message.slice(0, 200) : 'send failed'}));
    }
  }
  let invoiceSent = 0;
  for (const i of invoiceDue) {
    const message = brandEmail(invoiceReminderEmail({title: i.title, client: i.client, number: i.number, amount: money(i.open, i.currency), due: i.due, days: i.days_overdue, reviewUrl: `${origin}/review/${i.token}`, seller: i.seller}), brandOf(i));
    try {
      const ok = await sendBulk(sql, {owner: i.owner, project_id: i.project_id, event: 'payment_reminder', to: i.client_email, message, dedupe: `payment_reminder:${i.project_id}:${i.seq}:${i.sent + 1}`, fromName: i.verified ? i.business_name : null, replyTo: i.reply_to || (i.verified ? i.owner_email : null)});
      if (!ok) { failed++; continue; }
      await sql`INSERT INTO scopeflow.invoice_reminders (invoice_id, sent) VALUES (${i.id}, ${new Date().toISOString()})`;
      invoiceSent++;
    } catch (e) {
      failed++;
      console.error(JSON.stringify({invoice: i.number, error: e instanceof Error ? e.message.slice(0, 200) : 'send failed'}));
    }
  }
  let certificateSent = 0;
  for (const i of certificates) {
    const message = brandEmail(tdsCertificateEmail({title: i.title, client: i.client, seller: i.seller, number: i.number, amount: money(i.tds, i.currency), quarter: i.quarter_label, reviewUrl: `${origin}/review/${i.token}`}), brandOf(i));
    try {
      const ok = await sendBulk(sql, {owner: i.owner, project_id: i.project_id, event: 'tds_certificate_reminder', to: i.client_email, message, dedupe: `tds_certificate:${i.project_id}:${i.seq}:${i.quarter}`, fromName: i.verified ? i.business_name : null, replyTo: i.reply_to || (i.verified ? i.owner_email : null)});
      if (!ok) { failed++; continue; }
      certificateSent++;
    } catch (e) {
      failed++;
      console.error(JSON.stringify({invoice: i.number, error: e instanceof Error ? e.message.slice(0, 200) : 'send failed'}));
    }
  }
  console.log(JSON.stringify({sent, failed, checked: rows.length, invoice_reminders: invoiceSent, invoices_overdue: invoiceDue.length, tds_certificate_reminders: certificateSent}));
} finally { await sql.end(); }

function money(amount, currency) {
  try { return new Intl.NumberFormat(currency === 'INR' ? 'en-IN' : 'en-US', {style: 'currency', currency}).format(amount); }
  catch { return `${amount.toFixed(2)} ${currency}`; }
}

/**
 * Overdue invoices of owners with automatic reminders on, whose clients have an email and an
 * approved review link (`due`), and invoices paid net of TDS whose certificate reminder is due
 * this quarter (`certificates`). `filter` adds the tombstone and notify_client conditions.
 */
async function overdueInvoices(sql, now, filter) {
  const invoices = await sql.unsafe(`SELECT i.id, i.owner, i.project_id, i.version, i.seq, i.number, i.amount, i.currency, i.content, i.issued, p.client_email, p.timezone, v.token, b.auto_remind_days, b.business_name, b.brand_color, b.logo_hash, b.reply_to, COALESCE(oc.email_verified, false) AS verified, oc.email AS owner_email
    FROM scopeflow.invoices i JOIN scopeflow.projects p ON p.id = i.project_id JOIN scopeflow.business_profiles b ON b.owner = i.owner LEFT JOIN scopeflow.owner_contacts oc ON oc.owner = i.owner
    JOIN scopeflow.versions v ON v.project_id = i.project_id AND v.version = i.version
    WHERE b.auto_remind_days IS NOT NULL AND p.archived IS NULL AND p.client_email IS NOT NULL AND v.revoked = 0 AND v.status = 'approved' AND v.version = p.latest${filter}`);
  if (!invoices.length) return {due: [], certificates: []};
  const projects = [...new Set(invoices.map(i => i.project_id))];
  const entries = await sql`SELECT project_id, baseline_version, kind, payload FROM scopeflow.ledger_entries WHERE project_id = ANY(${projects}) AND kind IN ('payment', 'payment_received', 'refund')`;
  const reminders = await sql`SELECT invoice_id, sent FROM scopeflow.invoice_reminders WHERE invoice_id = ANY(${invoices.map(i => i.id)})`;
  // TDS already matched to a certificate (WS-03's table, when it exists; amounts in minor units).
  const [hasCredits] = await sql`SELECT to_regclass('scopeflow.tds_credits') AS t`;
  const credits = hasCredits?.t ? await sql`SELECT project_id, invoice_seq, amount_minor FROM scopeflow.tds_credits WHERE project_id = ANY(${projects})` : [];
  const certSent = await sql`SELECT project_id, dedupe_key FROM scopeflow.mail_outbox WHERE project_id = ANY(${projects}) AND event = 'tds_certificate_reminder' AND status IN ('sent', 'dev_log', 'queued')`;
  const due = [], certificates = [];
  for (const key of new Set(invoices.map(i => `${i.project_id}|${i.version}`))) {
    const list = invoices.filter(i => `${i.project_id}|${i.version}` === key);
    const {project_id, version, timezone} = list[0];
    const paid = entries.filter(e => e.project_id === project_id && e.baseline_version === version).reduce((a, e) => { try { return a + (e.kind === 'refund' ? -1 : 1) * (Number(JSON.parse(e.payload).amount) || 0); } catch { return a; } }, 0);
    const today = new Intl.DateTimeFormat('en-CA', {timeZone: timezone || 'UTC', year: 'numeric', month: '2-digit', day: '2-digit'}).format(new Date(now));
    const contents = new Map(list.map(i => [i.seq, JSON.parse(i.content)]));
    const statuses = invoiceStatuses(list.map(i => ({seq: i.seq, total: Number(i.amount), due: contents.get(i.seq).due, paid_before: contents.get(i.seq).agreement?.paid_before})), Math.round(paid * 100) / 100, today);
    for (const s of statuses) {
      const i = list.find(x => x.seq === s.seq), c = contents.get(s.seq);
      const minor = ['JPY', 'KRW', 'VND', 'CLP', 'ISK', 'UGX'].includes(i.currency) ? 1 : 100;
      const credited = credits.filter(r => r.project_id === project_id && Number(r.invoice_seq) === s.seq).reduce((a, r) => a + Number(r.amount_minor) / minor, 0);
      const plan = invoicePlan({open: s.open, tds: tdsExpected(c), credited, status: s.status});
      const base = {id: i.id, owner: i.owner, seq: i.seq, project_id, number: i.number, currency: i.currency, client_email: i.client_email, token: i.token, title: c.project?.title ?? '', client: c.client?.name ?? '', seller: i.business_name ?? '', business_name: i.business_name, brand_color: i.brand_color, logo_hash: i.logo_hash, reply_to: i.reply_to, verified: i.verified, owner_email: i.owner_email};
      if (plan.kind === 'tds_certificate') {
        // Never chase the TDS the client withholds; ask for the certificate once a quarter instead.
        const used = certSent.filter(r => r.project_id === project_id && String(r.dedupe_key ?? '').startsWith(`tds_certificate:${project_id}:${s.seq}:`)).map(r => String(r.dedupe_key).split(':').pop());
        const quarter = tdsCertificateReminderKey(String(c.issued ?? i.issued ?? '').slice(0, 10), today, used);
        if (quarter) certificates.push({...base, tds: plan.tds, quarter, quarter_label: tdsQuarterOf(String(c.issued ?? i.issued).slice(0, 10)).label});
        continue;
      }
      if (plan.kind !== 'payment') continue;
      const sent = reminders.filter(r => r.invoice_id === i.id).map(r => r.sent);
      if (invoiceReminderDue(s, sent, i.auto_remind_days, now)) due.push({...base, open: plan.chase, due: c.due, days_overdue: s.days_overdue, sent: sent.length});
    }
  }
  return {due, certificates};
}
