// Automatic reminders (suitable for the daily cron, after redact-expired.mjs). For every owner who
// turned on "Remind clients automatically" (business_profiles.auto_remind_days), emails a reminder
// for each latest version still awaiting a decision once it has waited that many days since it was
// saved or last emailed. Same limits as the manual button (lib/mail.ts): at most one email a day
// and three reminders per version; archived projects, revoked links and projects without a client
// email are skipped. Needs DATABASE_URL, APP_URL, RESEND_API_KEY and SCOPEFLOW_MAIL_FROM.
// `--dry-run` lists what would be sent and changes nothing.
import {createConnection} from '../db/connection.mjs';
import {autoReminderDue, mailConfig, reminderEmail, sendMail, MailError} from '../lib/mail.ts';

const dryRun = process.argv.includes('--dry-run');
const origin = process.env.APP_URL?.trim().replace(/\/$/, '');
if (!origin) { console.error('Set APP_URL to the public origin so reminders can link to the review page.'); process.exit(1); }
const config = mailConfig();
if (!config && !dryRun) { console.log(JSON.stringify({sent: 0, skipped: 'email delivery is not configured'})); process.exit(0); }
const sql = createConnection();
try {
  const rows = await sql`SELECT p.id, p.owner, p.client_email, p.last_sent, p.sent_version, p.reminders, v.version, v.token, v.content, v.created, b.auto_remind_days
    FROM scopeflow.projects p JOIN scopeflow.versions v ON v.project_id = p.id AND v.version = p.latest
    JOIN scopeflow.business_profiles b ON b.owner = p.owner
    WHERE b.auto_remind_days IS NOT NULL AND p.archived IS NULL AND v.status = 'pending' AND v.revoked = 0 AND p.client_email IS NOT NULL`;
  const now = Date.now();
  const due = rows.filter(r => autoReminderDue({last_sent: r.last_sent, sent_version: r.sent_version, reminders: r.reminders, version: r.version, created: r.created, auto_days: r.auto_remind_days}, now));
  if (dryRun) { console.log(JSON.stringify({dry_run: true, due: due.map(r => ({project_id: r.id, version: r.version, to: r.client_email}))})); process.exit(0); }
  let sent = 0, failed = 0;
  for (const r of due) {
    const content = JSON.parse(r.content);
    const message = reminderEmail({title: content.title, client: content.client, version: r.version, reviewUrl: `${origin}/review/${r.token}`, days: Math.floor((now - Date.parse(r.created)) / 86400_000)});
    try {
      await sendMail(config, r.client_email, message, `scopeflow-auto-remind-${r.id}-${r.version}-${(r.reminders ?? 0) + 1}`);
      // Same bookkeeping as the manual reminder; the WHERE clause keeps a concurrent manual send from being double counted.
      await sql`UPDATE scopeflow.projects SET last_sent = ${new Date().toISOString()}, reminders = CASE WHEN sent_version = ${r.version} THEN reminders + 1 ELSE 1 END, sent_version = ${r.version}
        WHERE id = ${r.id} AND last_sent IS NOT DISTINCT FROM ${r.last_sent}`;
      sent++;
    } catch (e) {
      failed++;
      console.error(JSON.stringify({project_id: r.id, error: e instanceof MailError ? e.message : 'send failed'}));
    }
  }
  console.log(JSON.stringify({sent, failed, checked: rows.length}));
} finally { await sql.end(); }
