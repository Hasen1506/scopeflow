import {db} from './server';
import {readonlyReason, type ReadonlyReason} from './identity';
import type {OtpChannel} from './otp';

// H1: a countersigning role's own link. Server-only.

export type CosignLink = {
  invite_id: string; cosigner_id: string; role: string; name: string | null; email: string | null; phone: string | null;
  id: string; project_id: string; version: number; latest: number; status: string; content: string; signer: string | null; decided: string | null;
  signature: string | null; decision_context: string | null; revoked: number; owner: string; timezone: string | null; owner_deleted: string | null;
  otp_channel: string | null; readonly: boolean; readonly_reason: ReadonlyReason | null;
};

export async function resolveCosignToken(token: string): Promise<CosignLink | null> {
  if (!/^[a-f0-9]{64}$/.test(token)) return null;
  const row = await db().prepare(`SELECT i.id AS invite_id,i.cosigner_id,i.role,i.name,i.email,i.phone,
      v.id,v.project_id,v.version,v.status,v.content,v.signer,v.decided,v.signature,v.decision_context,v.revoked,
      p.latest,p.owner,p.timezone,p.owner_deleted,p.otp_channel
    FROM scopeflow.cosign_invites i JOIN versions v ON v.project_id=i.project_id AND v.version=i.version JOIN projects p ON p.id=i.project_id
    WHERE i.token=?`).bind(token).first<Omit<CosignLink, 'readonly' | 'readonly_reason'>>();
  if (!row) return null;
  const reason = readonlyReason({status: row.status, revoked: row.revoked, owner_deleted: row.owner_deleted});
  return {...row, readonly: reason !== null || row.version !== row.latest, readonly_reason: reason};
}

/** Where this role's code goes: its email, else its phone (the project's SMS/WhatsApp choice), else nowhere. */
export function roleDestination(r: Pick<CosignLink, 'email' | 'phone' | 'otp_channel'>): {channel: OtpChannel; to: string} | null {
  if (r.email) return {channel: 'email', to: r.email};
  if (r.phone) return {channel: r.otp_channel === 'whatsapp' ? 'whatsapp' : 'sms', to: r.phone};
  return null;
}
