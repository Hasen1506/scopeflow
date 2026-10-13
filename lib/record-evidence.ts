import {anchorOf} from './ledger-server';
import {sha256} from './ledger';
import {anchorMessage, verifyRecordDetailed} from './signing';
import {zoneOrUtc} from './time';
import type {IdentityEvidence} from './otp';
import {acceptanceWording, canonical, chipWording, dayInZone, evidenceStatement, evidenceWording, maskAddress, sealStatus, verifyHref} from './evidence';

// The evidence block of a decided record (owner: WS-02), as JSON for the client page, the workspace
// and the receipt: what it proves (§6.2), its seal (§6.1), its fingerprints and the verify link.

export const parseContext = (raw: string | null | undefined) => { try { return raw ? JSON.parse(raw) as Record<string, unknown> : {}; } catch { return {}; } };

/** What the decided record proves, for the client page (§6.1, §6.2, L1, LT-09). */
export type EvidenceRow = {project_id: string; version: number; content: string; signer: string | null; decided: string | null; status: string; signature: string | null; decision_context: string | null; timezone?: string | null};
export async function recordEvidence(row: EvidenceRow, esign: {provider: string} | null = null) {
  const ctx = parseContext(row.decision_context);
  const identity = ctx.identity as (IdentityEvidence & {}) | undefined;
  const codeTo = identity ? (identity.method === 'email_otp' ? maskAddress('email', identity.email) : maskAddress('sms', identity.phone)) : null;
  const since = typeof ctx.contact_since === 'string' ? ctx.contact_since : null;
  const anchor = await anchorOf(row);
  const status = sealStatus(verifyRecordDetailed(anchorMessage(anchor), row.signature));
  const kid = row.signature?.split('.')[0] ?? null;
  const tz = zoneOrUtc(row.timezone);
  const verify = verifyHref(row.project_id, row.version, anchor);
  const doc = {esign};
  return {
    statement: evidenceStatement({decision: row.status, code_to: codeTo, on_file_since: since, owner_session: ctx.owner_session === true, time_zone: tz}),
    owner_session: ctx.owner_session === true,
    code_to: codeTo, on_file_since: since, on_file_since_text: since ? dayInZone(since, tz) : null,
    acceptance: acceptanceWording(doc),
    seal: {status, kid, chip: chipWording(status, doc), line: evidenceWording(status, {kid, verifyUrl: verify, doc})},
    fingerprint: anchor, content_sha256: await sha256(canonical(JSON.parse(row.content))), verify_url: verify,
  };
}

