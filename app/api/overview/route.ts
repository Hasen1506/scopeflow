import {db, json, owner, failure} from '@/lib/server';
import {computeAgreement, paymentsOf, type LedgerEntry} from '@/lib/ledger';
import {computeInsights} from '@/lib/insights';
import {totals} from '@/lib/money';
import {paymentsStatus} from '@/lib/razorpay';
import type {Scope} from '@/lib/scope';

// The Projects home in one read: per project, the numbers its status card shows (agreed fee with approved
// change orders, change orders awaiting the client and their value, tax-inclusive total, deposit due, money
// received (Razorpay deposits and payments the creator recorded) and the balance still owed), plus the cross-project summary that used to live on the Insights tab.
// Everything is computed from the ledger; nothing here is estimated. Read-only and private to the owner.
type Row = {project_id: string; version: number; status: string; content: string; last_sent: string | null; sent_version: number | null; reminders: number};
type EntryRow = {project_id: string; seq: number; kind: LedgerEntry['kind']; baseline_version: number; actor: LedgerEntry['actor']; payload: string; created: string};
const round2 = (n: number) => Math.round(n * 100) / 100;

export async function GET(request: Request) {
  try {
    const user = await owner(request);
    if (!user) return json({error: 'Sign in or provide a valid API token.'}, 401);
    const database = db();
    const [latest, rows] = await Promise.all([
      database.prepare('SELECT v.project_id,v.version,v.status,v.content,p.last_sent,p.sent_version,p.reminders FROM versions v JOIN projects p ON p.id=v.project_id AND p.latest=v.version WHERE p.owner=? ORDER BY p.created DESC LIMIT 100').bind(user).all<Row>(),
      database.prepare('SELECT e.project_id,e.seq,e.kind,e.baseline_version,e.actor,e.payload,e.created FROM ledger_entries e JOIN projects p ON p.id=e.project_id WHERE p.owner=? ORDER BY e.project_id,e.seq').bind(user).all<EntryRow>(),
    ]);
    const byProject = new Map<string, LedgerEntry[]>();
    for (const r of rows.results) {
      const list = byProject.get(r.project_id) ?? [];
      list.push({seq: r.seq, kind: r.kind, baseline_version: r.baseline_version, actor: r.actor, created: r.created, payload: JSON.parse(r.payload), payload_hash: '', prev_hash: '', hash: ''});
      byProject.set(r.project_id, list);
    }
    const agreements: Parameters<typeof computeInsights>[0] = [];
    const projects = latest.results.map(row => {
      const content = JSON.parse(row.content) as Scope;
      const quoted = totals(content);
      // When this version's link was last emailed (null if never through Scopeflow) and the reminders since.
      const sent = row.sent_version === row.version ? {last_sent: row.last_sent, reminders: row.reminders ?? 0} : {last_sent: null, reminders: 0};
      if (row.status !== 'approved') return {project_id: row.project_id, version: row.version, currency: content.currency, quoted_fee: content.fee, quoted_total: quoted.total, agreed_fee: null, agreed_total: null, pending_changes: 0, pending_value: 0, approved_changes: 0, deposit_due: null, paid: 0, balance: null, ...sent};
      const entries = (byProject.get(row.project_id) ?? []).filter(e => e.baseline_version === row.version);
      const agreement = computeAgreement(content, row.version, entries);
      agreements.push({project_id: row.project_id, title: content.title, client: content.client, agreement});
      const agreed = totals(content, agreement.fee);
      const proposed = agreement.change_orders.filter(c => c.status === 'proposed');
      const {paid} = paymentsOf(entries);
      return {
        project_id: row.project_id, version: row.version, currency: agreement.currency,
        quoted_fee: content.fee, quoted_total: quoted.total,
        agreed_fee: agreement.fee, agreed_total: agreed.total,
        pending_changes: agreement.pending, pending_value: round2(proposed.reduce((s, c) => s + c.fee_delta, 0)),
        approved_changes: agreement.change_orders.filter(c => c.status === 'approved').length,
        // The deposit is on the signed version (as on the review page), not on later change orders.
        deposit_due: quoted.deposit_pct > 0 ? quoted.deposit : null,
        paid, balance: round2(Math.max(0, agreed.total - paid)), ...sent,
      };
    });
    return json({projects, insights: computeInsights(agreements), online_deposits: paymentsStatus().enabled});
  } catch (e) { return failure(e); }
}
