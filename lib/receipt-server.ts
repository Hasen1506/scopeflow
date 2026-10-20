import {brandForProject} from './brand-server';
import {pdfBrand} from './brand';
import {db, json} from './server';
import {publicUrl} from './origin';
import {paymentsOf, sha256, type LedgerEntry} from './ledger';
import {agreementMoney, loadProfile, readSql} from './invoice-server';
import {anchorOf, loadLedger} from './ledger-server';
import {anchorMessage, publicSigningKey, verifyRecordDetailed, type SignatureCheck} from './signing';
import {chipWording, evidenceWording, sealStatus, maskAddress} from './evidence';
import {renderReceiptPdf, verifyUrl, type ReceiptModel} from './receipt';
import {validTimeZone} from './time';
import {timestampsFor} from './timestamps';
import {maybeSignPdf} from './pades';
import {ensurePdfFonts} from './pdf-fonts';
import {renderStatementPdf, statementModel} from './statement';
import type {Scope} from './scope';

export type DecidedRow = {id: string; project_id: string; version: number; status: string; content: string; signer: string | null; comment: string | null; decided: string | null; signature: string | null; decision_context: string | null; timezone?: string | null; contact_since?: string | null};

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
  await ensurePdfFonts();
  const content = JSON.parse(row.content) as Scope;
  const anchor = await anchorOf(row);
  let ledger: ReceiptModel['ledger'] = null, payments: ReceiptModel['payments'] = [];
  if (row.status === 'approved') {
    const l = await loadLedger(row.project_id, {forClient: true});
    const entries = l.entries.filter(e => e.baseline_version === row.version);
    if (entries.length) ledger = {head: entries[entries.length - 1].hash, count: entries.length};
    payments = paymentsOf(entries).lines;
  }
  const cosigns = row.status === 'approved' ? (await db().prepare('SELECT role,signer,signed,signature,context FROM version_cosigns WHERE project_id=? AND version=? ORDER BY signed').bind(row.project_id, row.version).all<{role: string; signer: string; signed: string; signature: string | null; context: string | null}>()).results.map(({context: c, ...rest}) => { let v: string | null = null; try { v = (JSON.parse(c ?? '{}') as {verified_to?: string}).verified_to ?? null; } catch { v = null; } return {...rest, verified_to: v}; }) : [];
  const esign = await db().prepare("SELECT provider,signed_sha256,completed FROM scopeflow.esign_records WHERE project_id=? AND version=? AND status='signed'").bind(row.project_id, row.version).first<{provider: string; signed_sha256: string; completed: string | null}>();
  const timestamps = (await timestampsFor(row.project_id, row.version)).map(({subject, digest, tsa, gen_time}) => ({subject, digest, tsa, gen_time}));
  let context: ReceiptModel['context'] = null;
  try { context = row.decision_context ? JSON.parse(row.decision_context) : null; } catch { context = null; }
  const origin = publicUrl(request, '/').replace(/\/$/, '');
  return {
    project_id: row.project_id, version: row.version, status: row.status, content,
    content_sha256: await sha256(JSON.stringify(content)),
    signer: row.signer, decided: row.decided, comment: row.comment,
    anchor, signature: row.signature, key: keyFor(row.signature), context, ledger, payments, cosigns, timestamps,
    seal: sealStatus(verifyRecordDetailed(anchorMessage(anchor), row.signature)), contact_since: row.contact_since ?? null, esign: esign ?? null,
    time_zone: receiptTimeZone(request, row.timezone), generated: new Date().toISOString(),
    verify_url: verifyUrl(origin, row.project_id, row.version, anchor),
  };
}

/** A PDF download, PAdES-signed when a document-signing certificate is configured (lib/pades.ts). */
export async function pdfResponse(bytes: Uint8Array, filename: string) {
  const signed = await maybeSignPdf(bytes);
  return new Response(Buffer.from(signed), {status: 200, headers: {
    'Content-Type': 'application/pdf',
    'Content-Disposition': `attachment; filename="${filename.replace(/[^A-Za-z0-9._-]/g, '-')}"`,
    'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff',
  }});
}

function pdfBytesResponse(bytes: Uint8Array, filename: string, cached: boolean) {
  return new Response(Buffer.from(bytes), {status: 200, headers: {
    'Content-Type': 'application/pdf',
    'Content-Disposition': `attachment; filename="${filename.replace(/[^A-Za-z0-9._-]/g, '-')}"`,
    'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff', 'X-Receipt-Cache': cached ? 'hit' : 'miss',
  }});
}

/** PDF receipt for a decided version, or a JSON error when it has no decision yet. */
export async function receiptResponse(request: Request, row: DecidedRow | null) {
  if (!row) return json({error: 'This record was not found.'}, 404);
  if (row.status === 'pending' || !row.decided) return json({error: 'This version has no client decision yet, so there is no receipt.', code: 'no_decision'}, 409);
  const model = await receiptModel(request, row);
  const brand = pdfBrand(await brandForProject(row.project_id));
  const filename = `scopeflow-receipt-${row.project_id.slice(0, 12)}-v${row.version}.pdf`;
  // QA-01: a receipt is rendered (and PAdES-signed) once per record state, then served from the cache.
  const {generated: _generated, ...stable} = model;
  const key = await sha256(JSON.stringify({v: 1, stable, brand}));
  const hit = await db().prepare('SELECT pdf FROM scopeflow.receipt_cache WHERE key=?').bind(key).first<{pdf: string}>().catch(() => null);
  if (hit) return pdfBytesResponse(Buffer.from(hit.pdf, 'base64'), filename, true);
  const signed = await maybeSignPdf(renderReceiptPdf(model, brand));
  await db().prepare('INSERT INTO scopeflow.receipt_cache (key,project_id,pdf,created) VALUES (?,?,?,?) ON CONFLICT (key) DO NOTHING').bind(key, row.project_id, Buffer.from(signed).toString('base64'), new Date().toISOString()).run().catch(() => {/* the cache never blocks a receipt */});
  return pdfBytesResponse(signed, filename, false);
}

export type Verification = {
  record: 'match' | 'mismatch' | 'not_found';
  /** C6: 'legacy_key' for an allow-listed earlier key; 'unknown_key' for a key this server does not trust. */
  signature: SignatureCheck | null;
  /** The full fingerprint, when the caller gave the 16-character short form (LT-09). */
  anchor?: string;
  evidence?: {chip: string; line: string};
  details: null | {title: string; client: string; version: number; status: string; signer: string | null; decided: string | null; content_sha256: string; kid: string | null; signature: string | null; code_to: string | null; owner_session: boolean};
};

/**
 * Public check behind the receipt's QR code: does the stored record still hash to the printed
 * fingerprint, and does the stored Scopeflow signature over that fingerprint verify? Nothing is
 * disclosed unless the caller already holds the fingerprint (the full 64 characters, or the 16 the
 * page prints next to the project id).
 */
export async function verifyAnchor(projectId: string, version: number, anchor: string): Promise<Verification> {
  const row = await db().prepare("SELECT project_id,version,status,content,signer,decided,signature,decision_context FROM versions WHERE project_id=? AND version=? AND status<>'pending'").bind(projectId, version).first<DecidedRow>();
  if (!row) return {record: 'not_found', signature: null, details: null};
  const own = await anchorOf(row);
  const short = anchor.length === 16;
  if (short ? !own.startsWith(anchor) : own !== anchor) return {record: 'mismatch', signature: null, details: null};
  const content = JSON.parse(row.content) as Scope;
  const check = verifyRecordDetailed(anchorMessage(own), row.signature);
  const status = sealStatus(check);
  const kid = row.signature?.split('.')[0] ?? null;
  let ctx: {owner_session?: boolean; identity?: {method?: string; email?: string; phone?: string}} = {};
  try { ctx = row.decision_context ? JSON.parse(row.decision_context) : {}; } catch { ctx = {}; }
  const codeTo = ctx.identity?.method === 'email_otp' && ctx.identity.email ? maskAddress('email', ctx.identity.email) : ctx.identity?.phone ? maskAddress('sms', ctx.identity.phone) : null;
  return {
    record: 'match', signature: check, ...(short ? {anchor: own} : {}),
    evidence: {chip: chipWording(status), line: evidenceWording(status, {kid})},
    details: {title: content.title, client: content.client, version: row.version, status: row.status, signer: row.signer, decided: row.decided, content_sha256: await sha256(JSON.stringify(content)), kid, signature: row.signature, code_to: codeTo, owner_session: ctx.owner_session === true},
  };
}

/**
 * N5: the statement's tax-head kind for a project, worked out as the invoices do (agreementMoney):
 * undefined for a single head, else 'intra' (CGST+SGST) or 'inter' (IGST). Never blocks the statement.
 */
async function statementKind(projectId: string, content: Scope, entries: LedgerEntry[], version: number) {
  try {
    const p = await db().prepare('SELECT owner,client_gstin,client_state,client_address FROM projects WHERE id=?').bind(projectId).first<{owner: string; client_gstin: string | null; client_state: string | null; client_address: string | null}>();
    if (!p) return undefined;
    const {profile} = await loadProfile(readSql(), p.owner);
    const {kind} = agreementMoney(content, entries, version, profile, p);
    return kind !== 'single' ? kind : undefined;
  } catch { return undefined; }
}

export async function statementResponse(request: Request, projectId: string, {version, timezone}: {version?: number; timezone?: string | null} = {}) {
  await ensurePdfFonts();
  const l = await loadLedger(projectId, {forClient: true});
  if (!l.baseline || !l.content || !l.agreement) return json({error: 'There is no approved agreement yet, so there is no statement.', code: 'not_approved'}, 409);
  if (version !== undefined && version !== l.baseline.version) return json({error: 'This link is for a version that is not the current agreement.', code: 'superseded'}, 409);
  // N5: the same tax heads as the invoices (CGST+SGST or IGST), from the owner's profile and the project's billing details.
  const kind = await statementKind(projectId, l.content, l.entries, l.baseline.version);
  const model = statementModel({project_id: projectId, version: l.baseline.version, content: l.content, agreement: l.agreement, entries: l.entries, time_zone: receiptTimeZone(request, timezone), generated: new Date().toISOString(), kind});
  return pdfResponse(renderStatementPdf(model, pdfBrand(await brandForProject(projectId))), `scopeflow-statement-${projectId.slice(0, 12)}-v${l.baseline.version}.pdf`);
}
