import {db, json} from './server';
import {publicUrl} from './origin';
import {sha256} from './ledger';
import {anchorOf, loadLedger} from './ledger-server';
import {anchorMessage, publicSigningKey, verifyRecord, type SignatureState} from './signing';
import {renderReceiptPdf, validTimeZone, verifyUrl, type ReceiptModel} from './receipt';
import type {Scope} from './scope';

export type DecidedRow = {id: string; project_id: string; version: number; status: string; content: string; signer: string | null; comment: string | null; decided: string | null; signature: string | null; decision_context: string | null; timezone?: string | null};

/** Time zone for receipt timestamps: a valid IANA `tz` query parameter, else the project's time zone, else UTC. */
export function receiptTimeZone(request: Request, projectZone?: string | null) {
  const tz = new URL(request.url).searchParams.get('tz');
  return validTimeZone(tz) ? tz : validTimeZone(projectZone) ? projectZone : 'UTC';
}

function keyFor(signature: string | null) {
  const current = publicSigningKey();
  if (!signature) return current ? {kid: current.kid, x: current.x} : null;
  const kid = signature.split('.')[0];
  return current && current.kid === kid ? {kid, x: current.x} : {kid, x: '(retired key; see /api/signing-key)'};
}

/** Builds the receipt model for a decided version. */
export async function receiptModel(request: Request, row: DecidedRow): Promise<ReceiptModel> {
  const content = JSON.parse(row.content) as Scope;
  const anchor = await anchorOf(row);
  let ledger: ReceiptModel['ledger'] = null;
  if (row.status === 'approved') {
    const l = await loadLedger(row.project_id, {forClient: true});
    const entries = l.entries.filter(e => e.baseline_version === row.version);
    if (entries.length) ledger = {head: entries[entries.length - 1].hash, count: entries.length};
  }
  let context: ReceiptModel['context'] = null;
  try { context = row.decision_context ? JSON.parse(row.decision_context) : null; } catch { context = null; }
  const origin = publicUrl(request, '/').replace(/\/$/, '');
  return {
    project_id: row.project_id, version: row.version, status: row.status, content,
    content_sha256: await sha256(JSON.stringify(content)),
    signer: row.signer, decided: row.decided, comment: row.comment,
    anchor, signature: row.signature, key: keyFor(row.signature), context, ledger,
    time_zone: receiptTimeZone(request, row.timezone), generated: new Date().toISOString(),
    verify_url: verifyUrl(origin, row.project_id, row.version, anchor),
  };
}

export function pdfResponse(bytes: Uint8Array, filename: string) {
  return new Response(Buffer.from(bytes), {status: 200, headers: {
    'Content-Type': 'application/pdf',
    'Content-Disposition': `attachment; filename="${filename.replace(/[^A-Za-z0-9._-]/g, '-')}"`,
    'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff',
  }});
}

/** PDF receipt for a decided version, or a JSON error when it has no decision yet. */
export async function receiptResponse(request: Request, row: DecidedRow | null) {
  if (!row) return json({error: 'This record was not found.'}, 404);
  if (row.status === 'pending' || !row.decided) return json({error: 'This version has no client decision yet, so there is no receipt.', code: 'no_decision'}, 409);
  const model = await receiptModel(request, row);
  return pdfResponse(renderReceiptPdf(model), `scopeflow-receipt-${row.project_id.slice(0, 12)}-v${row.version}.pdf`);
}

export type Verification = {
  record: 'match' | 'mismatch' | 'not_found';
  signature: SignatureState | null;
  details: null | {title: string; client: string; version: number; status: string; signer: string | null; decided: string | null; content_sha256: string; kid: string | null; signature: string | null};
};

/**
 * Public check behind the receipt's QR code: does the stored record still hash to the
 * printed fingerprint, and does the stored Scopeflow signature over that fingerprint verify?
 * Nothing is disclosed unless the caller already holds the 256-bit fingerprint.
 */
export async function verifyAnchor(projectId: string, version: number, anchor: string): Promise<Verification> {
  const row = await db().prepare("SELECT project_id,version,status,content,signer,decided,signature FROM versions WHERE project_id=? AND version=? AND status<>'pending'").bind(projectId, version).first<DecidedRow>();
  if (!row) return {record: 'not_found', signature: null, details: null};
  const own = await anchorOf(row);
  if (own !== anchor) return {record: 'mismatch', signature: null, details: null};
  const content = JSON.parse(row.content) as Scope;
  return {
    record: 'match',
    signature: verifyRecord(anchorMessage(anchor), row.signature),
    details: {title: content.title, client: content.client, version: row.version, status: row.status, signer: row.signer, decided: row.decided, content_sha256: await sha256(JSON.stringify(content)), kid: row.signature?.split('.')[0] ?? null, signature: row.signature},
  };
}
