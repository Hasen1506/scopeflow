// Automatic reminders (suitable for the daily cron, after redact-expired.mjs). For every owner who
// turned on "Remind clients automatically" (business_profiles.auto_remind_days), emails a reminder
// for each latest version still awaiting a decision once it has waited that many days since it was
// saved or last emailed. Same limits as the manual button (lib/mail.ts): at most one email a day
// and three reminders per version; archived projects, revoked links and projects without a client
// email are skipped. Needs DATABASE_URL, APP_URL, RESEND_API_KEY and SCOPEFLOW_MAIL_FROM.
//
// Then, for the same owners, payment reminders for overdue invoices (Net-X): an invoice past its
// due date that the payments on the record do not cover gets a reminder on the day after it falls
// due and then every auto_remind_days, at most three in all (scopeflow.invoice_reminders).
// `--dry-run` lists what would be sent and changes nothing.
import {createConnection} from '../db/connection.mjs';
import {autoReminderDue, brandEmail, invoiceReminderEmail, mailConfig, reminderEmail, sendMail, MailError} from '../lib/mail.ts';
import {invoiceReminderDue, invoiceStatuses} from '../lib/invoice-status.ts';

const dryRun = process.argv.includes('--dry-run');
const origin = process.env.APP_URL?.trim().replace(/\/$/, '');
if (!origin) { console.error('Set APP_URL to the public origin so reminders can link to the review page.'); process.exit(1); }
const config = mailConfig();
if (!config && !dryRun) { console.log(JSON.stringify({sent: 0, skipped: 'email delivery is not configured'})); process.exit(0); }
/** The owner's brand for the email header (lib/mail.ts brandEmail), from the business profile columns. */
const brandOf = r => (r.brand_color || r.logo_hash) ? {name: r.business_name ?? '', color: r.brand_color, logoUrl: r.logo_hash ? `${origin}/api/brand/${r.logo_hash}` : null} : null;
const sql = createConnection();
try {
  const rows = await sql`SELECT p.id, p.owner, p.client_email, p.last_sent, p.sent_version, p.reminders, v.version, v.token, v.content, v.created, b.auto_remind_days, b.business_name, b.brand_color, b.logo_hash, b.reply_to
    FROM scopeflow.projects p JOIN scopeflow.versions v ON v.project_id = p.id AND v.version = p.latest
    JOIN scopeflow.business_profiles b ON b.owner = p.owner
    WHERE b.auto_remind_days IS NOT NULL AND p.archived IS NULL AND v.status = 'pending' AND v.revoked = 0 AND p.client_email IS NOT NULL`;
  const now = Date.now();
  const invoiceDue = await overdueInvoices(sql, now);
  const due = rows.filter(r => autoReminderDue({last_sent: r.last_sent, sent_version: r.sent_version, reminders: r.reminders, version: r.version, created: r.created, auto_days: r.auto_remind_days}, now));
  if (dryRun) { console.log(JSON.stringify({dry_run: true, due: due.map(r => ({project_id: r.id, version: r.version, to: r.client_email})), invoices: invoiceDue.map(i => ({project_id: i.project_id, number: i.number, to: i.client_email, days_overdue: i.days_overdue}))})); process.exit(0); }
  let sent = 0, failed = 0;
  for (const r of due) {
    const content = JSON.parse(r.content);
    const message = brandEmail(reminderEmail({title: content.title, client: content.client, version: r.version, reviewUrl: `${origin}/review/${r.token}`, days: Math.floor((now - Date.parse(r.created)) / 86400_000)}), brandOf(r));
    try {
      await sendMail(config, r.client_email, message, `scopeflow-auto-remind-${r.id}-${r.version}-${(r.reminders ?? 0) + 1}`, {fromName: r.business_name, replyTo: r.reply_to});
      // Same bookkeeping as the manual reminder; the WHERE clause keeps a concurrent manual send from being double counted.
      await sql`UPDATE scopeflow.projects SET last_sent = ${new Date().toISOString()}, reminders = CASE WHEN sent_version = ${r.version} THEN reminders + 1 ELSE 1 END, sent_version = ${r.version}
        WHERE id = ${r.id} AND last_sent IS NOT DISTINCT FROM ${r.last_sent}`;
      sent++;
    } catch (e) {
      failed++;
      console.error(JSON.stringify({project_id: r.id, error: e instanceof MailError ? e.message : 'send failed'}));
    }
  }
  let invoiceSent = 0;
  for (const i of invoiceDue) {
    const message = brandEmail(invoiceReminderEmail({title: i.title, client: i.client, number: i.number, amount: money(i.open, i.currency), due: i.due, days: i.days_overdue, reviewUrl: `${origin}/review/${i.token}`, seller: i.seller}), brandOf(i));
    try {
      await sendMail(config, i.client_email, message, `scopeflow-invoice-remind-${i.id}-${i.sent + 1}`, {fromName: i.business_name, replyTo: i.reply_to});
      await sql`INSERT INTO scopeflow.invoice_reminders (invoice_id, sent) VALUES (${i.id}, ${new Date().toISOString()})`;
      invoiceSent++;
    } catch (e) {
      failed++;
      console.error(JSON.stringify({invoice: i.number, error: e instanceof MailError ? e.message : 'send failed'}));
    }
  }
  console.log(JSON.stringify({sent, failed, checked: rows.length, invoice_reminders: invoiceSent, invoices_overdue: invoiceDue.length}));
} finally { await sql.end(); }

function money(amount, currency) {
  try { return new Intl.NumberFormat(currency === 'INR' ? 'en-IN' : 'en-US', {style: 'currency', currency}).format(amount); }
  catch { return `${amount.toFixed(2)} ${currency}`; }
}

/** Overdue invoices of owners with automatic reminders on, whose clients have an email and an approved review link. */
async function overdueInvoices(sql, now) {
  const invoices = await sql`SELECT i.id, i.project_id, i.version, i.seq, i.number, i.amount, i.currency, i.content, p.client_email, p.timezone, v.token, b.auto_remind_days, b.business_name, b.brand_color, b.logo_hash, b.reply_to
    FROM scopeflow.invoices i JOIN scopeflow.projects p ON p.id = i.project_id JOIN scopeflow.business_profiles b ON b.owner = i.owner
    JOIN scopeflow.versions v ON v.project_id = i.project_id AND v.version = i.version
    WHERE b.auto_remind_days IS NOT NULL AND p.archived IS NULL AND p.client_email IS NOT NULL AND v.revoked = 0 AND v.status = 'approved' AND v.version = p.latest`;
  if (!invoices.length) return [];
  const projects = [...new Set(invoices.map(i => i.project_id))];
  const entries = await sql`SELECT project_id, baseline_version, kind, payload FROM scopeflow.ledger_entries WHERE project_id = ANY(${projects}) AND kind IN ('payment', 'payment_received', 'refund')`;
  const reminders = await sql`SELECT invoice_id, sent FROM scopeflow.invoice_reminders WHERE invoice_id = ANY(${invoices.map(i => i.id)})`;
  const out = [];
  for (const key of new Set(invoices.map(i => `${i.project_id}|${i.version}`))) {
    const list = invoices.filter(i => `${i.project_id}|${i.version}` === key);
    const {project_id, version, timezone} = list[0];
    const paid = entries.filter(e => e.project_id === project_id && e.baseline_version === version).reduce((a, e) => { try { return a + (e.kind === 'refund' ? -1 : 1) * (Number(JSON.parse(e.payload).amount) || 0); } catch { return a; } }, 0);
    const today = new Intl.DateTimeFormat('en-CA', {timeZone: timezone || 'UTC', year: 'numeric', month: '2-digit', day: '2-digit'}).format(new Date(now));
    const contents = new Map(list.map(i => [i.seq, JSON.parse(i.content)]));
    const statuses = invoiceStatuses(list.map(i => ({seq: i.seq, total: Number(i.amount), due: contents.get(i.seq).due, paid_before: contents.get(i.seq).agreement.paid_before})), Math.round(paid * 100) / 100, today);
    for (const s of statuses) {
      const i = list.find(x => x.seq === s.seq), c = contents.get(s.seq);
      const sent = reminders.filter(r => r.invoice_id === i.id).map(r => r.sent);
      if (invoiceReminderDue(s, sent, i.auto_remind_days, now)) out.push({id: i.id, project_id, number: i.number, currency: i.currency, open: s.open, due: c.due, days_overdue: s.days_overdue, client_email: i.client_email, token: i.token, title: c.project.title, client: c.client.name, seller: i.business_name ?? '', business_name: i.business_name, brand_color: i.brand_color, logo_hash: i.logo_hash, reply_to: i.reply_to, sent: sent.length});
    }
  }
  return out;
}
