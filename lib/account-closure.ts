import {db} from './server';
import {defaultRetentionDays} from './settings';

// What a client link shows about the creator's account (H10, M32), for the client page (WS-07):
//  * closed: the creator closed their ScopeFlow account; the record is kept read-only until a date;
//  * retention_days: how long the client's IP address and browser are kept (the data notice).
export type ClientNotice = {retention_days: number | null; privacy_url: string; closed: null | {closed_at: string; kept_until: string; message: string}};
export const closedMessage = (until: string) => `The creator closed their ScopeFlow account; this record is kept for you until ${new Date(until).toUTCString().slice(5, 16)}.`;
export const dataNotice = (days: number | null) => `We record your name, time, IP address and browser to evidence this decision; ${days ? `kept for ${days} days` : 'kept until the creator deletes the project'}.`;

export async function clientNotice(token: string): Promise<ClientNotice | null> {
  if (!/^[a-f0-9]{64}$/.test(token)) return null;
  const row = await db().prepare('SELECT p.owner_deleted,p.retain_until,p.legal_hold,coalesce(p.retention_days,s.context_retention_days) AS days FROM versions v JOIN projects p ON p.id=v.project_id LEFT JOIN account_settings s ON s.owner=p.owner WHERE v.token=? AND v.revoked=0')
    .bind(token).first<{owner_deleted: string | null; retain_until: string | null; legal_hold: boolean; days: number | null}>();
  if (!row) return null;
  const days = row.days ?? defaultRetentionDays();
  return {retention_days: days, privacy_url: '/privacy', closed: row.owner_deleted && row.retain_until ? {closed_at: row.owner_deleted, kept_until: row.retain_until, message: closedMessage(row.retain_until)} : null};
}
