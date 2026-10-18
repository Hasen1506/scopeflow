import {after} from 'next/server';
import {paymentsStatus} from '@/lib/razorpay';
import {loadBrand} from '@/lib/brand-server';
import {textSafe} from '@/lib/brand';
import {timestampRecord} from '@/lib/timestamps';
import {db, json, body, safeOrigin, allowWrite, allowRead, failure, ipKey} from '@/lib/server';
import {loadLedger, anchorOf} from '@/lib/ledger-server';
import {sha256} from '@/lib/ledger';
import {anchorMessage, signRecord, publicSigningKey} from '@/lib/signing';
import {decisionContext, isOwnerSession} from '@/lib/decision';
import {depositView} from '@/lib/deposit-server';
import {clientInvoices} from '@/lib/invoice-server';
import {zoneOrUtc} from '@/lib/time';
import {linkExpired, linkExpires} from '@/lib/link';
import {cosignStatus, type Cosign} from '@/lib/cosign';
import {signEvidence, type OtpChannel} from '@/lib/otp';
import {checkDecisionProof, maskAddress, signingBlocked, signingUnavailable} from '@/lib/identity';
import {canonical, decisionBody, decisionProblem, formatExpiry} from '@/lib/evidence';
import {resolveReviewToken, linkStateOf, diffBaseFor, newerPointer, senderOf, markSent, rolesFor, inviteCosigners, type ReviewLink} from '@/lib/review-link';
import {onBaselineApproved} from '@/lib/ledger-hooks';
import {notify} from '@/lib/notify';
import {withIdempotency} from '@/lib/idempotency';
import {toResponse} from '@/lib/errors';
type Ctx = {params: Promise<{token: string}>};

const notFound = () => json({error: 'This review link was not found.', code: 'not_found'}, 404);
/** L3 + WS-07: an expired link names its expiry in the project's zone and who to ask for a new one. */
async function expiredReply(row: ReviewLink) {
  const at = linkExpires(linkStateOf(row))!;
  return json({error: `This review link expired on ${formatExpiry(at, row.timezone)}. Ask the creator for a new link.`, code: 'link_expired', expired: at, expired_text: formatExpiry(at, row.timezone), sender: await senderOf(row.project_id)}, 410);
}
const readonlyReply = (row: ReviewLink) => json({error: 'The creator closed this link for new changes. Your record, receipt and statement stay available here.', code: 'link_readonly', readonly_reason: row.readonly_reason}, 403);
import {recordEvidence, parseContext} from '@/lib/record-evidence';

export async function GET(request: Request, ctx: Ctx) {
  try {
    const {token} = await ctx.params;
    if (!await allowRead('review-ip:' + await ipKey(request), 300)) return json({error: 'Too many requests. Try again in a minute.'}, 429);
    const row = await resolveReviewToken(token);
    if (!row) return notFound();
    if (!row.readonly && linkExpired(linkStateOf(row))) return expiredReply(row);
    // Owner-private "opened" log for this version; the creator previewing their own link does not count.
    if (!await isOwnerSession(request, row.owner)) {
      const now = new Date().toISOString();
      await db().prepare('INSERT INTO review_views (project_id,version,first_viewed,last_viewed,views) VALUES (?,?,?,?,1) ON CONFLICT (project_id,version) DO UPDATE SET last_viewed=excluded.last_viewed,views=review_views.views+1').bind(row.project_id, row.version, now, now).run().catch(() => {/* never block the review on the log */});
    }
    const content = JSON.parse(row.content) as {currency?: string};
    const timezone = row.timezone;
    // H2/M29: the diff base is the last version this client approved, else the last one sent; never a draft, never revoked.
    const rawCompare = new URL(request.url).searchParams.get('compare');
    const compare = rawCompare !== null && /^\d{1,6}$/.test(rawCompare) ? Number(rawCompare) : null;
    const base = await diffBaseFor(row.project_id, row.version, compare);
    const scope = {id: row.id, project_id: row.project_id, version: row.version, revoked: row.revoked, content, status: row.status, signer: row.signer, comment: row.comment, created: row.created, decided: row.decided, latest: row.latest, sealed: !!row.signature, signature: row.signature ?? null};
    const expires = row.readonly ? null : linkExpires(linkStateOf(row));
    // The approved latest version doubles as the client's view of the post-approval ledger.
    let ledger = null;
    if (row.version === row.latest && row.status === 'approved') {
      const l = await loadLedger(row.project_id, {forClient: true});
      if (l.baseline?.id === row.id) ledger = {entries: l.entries, agreement: l.agreement, anchors: l.anchors, head: l.head, seal: l.seal, signatures: l.signatures, invoices: await clientInvoices(row.project_id, row.version, l.entries, timezone), online_payments: !row.readonly && paymentsStatus(process.env, content.currency).enabled};
    }
    // PR F: the deposit due on signature, once approved. A read-only link takes no payment (H4).
    const dep = row.status === 'approved' && row.version === row.latest ? await depositView(row.project_id, row.version, JSON.parse(row.content)) : null;
    const deposit = dep ? {...dep, enabled: dep.enabled && !row.readonly} : null;
    // Countersignatures on the approved latest version. Roles sign on their own links (H1); the
    // client page only shows who signed and the masked address their code went to.
    let cosign = null;
    if (row.status === 'approved' && row.version === row.latest) {
      const required = await rolesFor(row.project_id, row.version, row.project_cosigners);
      if (required.length) {
        const signed = await db().prepare('SELECT cosigner_id,role,signer,signed,signature,context FROM version_cosigns WHERE project_id=? AND version=?').bind(row.project_id, row.version).all<Cosign & {context: string | null}>();
        const status = cosignStatus(required, signed.results.map(({context: _c, ...s}) => s));
        const verified = new Map(signed.results.map(s => [s.cosigner_id, (parseContext(s.context).verified_to as string | undefined) ?? null]));
        cosign = {...status, roles: status.roles.map(r => ({...r, cosign: r.cosign ? {signer: r.cosign.signer, signed: r.cosign.signed, signature: r.cosign.signature, verified_to: verified.get(r.id) ?? null} : null}))};
      }
    }
    const pendingCo = !!ledger && (ledger.agreement?.pending ?? 0) > 0;
    const channel = (row.otp_channel ?? 'email') as OtpChannel;
    const to = channel === 'email' ? row.client_email : row.client_phone;
    const identity_check = !row.readonly && row.require_otp && row.version === row.latest && (row.status === 'pending' || pendingCo)
      ? {method: channel + '_otp', channel, to: to ? maskAddress(channel, to) : null, action: row.status === 'pending' ? 'decision' : 'change_order'}
      : null;
    const b = await loadBrand(row.owner);
    const brand = b ? {name: b.name, color: b.color, text_color: textSafe(b.color), logo_url: b.logoHash ? `/api/brand/${b.logoHash}` : null} : null;
    const esignRow = await db().prepare('SELECT provider,status,signing_url FROM scopeflow.esign_records WHERE project_id=? AND version=?').bind(row.project_id, row.version).first<{provider: string; status: string; signing_url: string | null}>();
    const evidence = row.status !== 'pending' && row.decided ? await recordEvidence(row, esignRow?.status === 'signed' ? {provider: esignRow.provider} : null) : null;
    // C5: changes of the client contact, shown in the client timeline (masked).
    const contactHistory = (await db().prepare('SELECT field,from_masked,to_masked,reason,at FROM scopeflow.contact_history WHERE project_id=? ORDER BY at').bind(row.project_id).all<{field: string; from_masked: string | null; to_masked: string | null; reason: string; at: string}>()).results;
    const newer = row.version < row.latest ? await newerPointer(row.project_id, row.latest) : null;
    return json({
      scope, ...(brand ? {brand} : {}),
      previous: base.previous, previous_version: base.previous_version, compare_versions: base.compare_versions,
      ledger, signing_key: publicSigningKey(), ...(deposit ? {deposit} : {}), time_zone: zoneOrUtc(timezone),
      ...(expires ? {link_expires: expires, link_expires_text: formatExpiry(expires, timezone)} : {}),
      ...(identity_check ? {identity_check} : {}), ...(cosign ? {cosign} : {}),
      // H4/WS-07: read-only links still show the record, ledger, invoices, receipt and statement.
      readonly: row.readonly, readonly_reason: row.readonly_reason, kept_until: row.readonly_reason === 'account_closed' ? row.retain_until : null,
      ...(evidence ? {evidence} : {}),
      ...(esignRow ? {esign: {provider: esignRow.provider, status: esignRow.status, signing_url: !row.readonly && esignRow.status === 'requested' ? esignRow.signing_url : null}} : {}),
      ...(contactHistory.length ? {contact_history: contactHistory} : {}),
      ...(newer ? newer : {}),
      ...await (async () => { const sender = await senderOf(row.project_id); return sender.name || sender.email ? {sender} : {}; })(),
    });
  } catch (e) { return failure(e); }
}

export async function POST(request: Request, ctx: Ctx) {
  try {
    if (!safeOrigin(request)) return json({error: 'Origin not allowed.'}, 403);
    const {token} = await ctx.params;
    const row = await resolveReviewToken(token);
    if (!row) return notFound();
    if (row.readonly) return readonlyReply(row);
    // C1: in production a record that cannot be sealed with the dedicated key is never created.
    if (signingBlocked()) return signingUnavailable();
    if (linkExpired(linkStateOf(row))) return expiredReply(row);
    if (!await allowWrite('review:' + row.id, 10)) return json({error: 'Too many attempts. Try again in a minute.'}, 429);
    let raw;
    try { raw = await body(request); } catch { return json({error: 'Provide valid JSON under 24 KB.'}, 400); }
    // M28 (WS-10): a retried decision with the same Idempotency-Key gets the original answer.
    return await withIdempotency(request, 'decision:' + row.id, raw, () => decide(request, row, token, raw));
  } catch (e) {
    if (String(e).includes('closed this account')) return json({error: 'The creator closed their ScopeFlow account; this record is read-only.', code: 'account_closed'}, 409);
    return toResponse(e) ?? failure(e);
  }
}

async function decide(request: Request, row: ReviewLink, token: string, raw: unknown): Promise<Response> {
  // SF-15: the reviewer's acknowledgement and the exact content they saw are required and recorded.
  const problem = decisionProblem(raw);
  if (problem) return json({error: problem}, 400);
  const input = {data: decisionBody.parse(raw)};
  // L12: a decision on a replaced version points to the newer one (the page keeps the typed comment).
  if (row.version !== row.latest) return json({error: 'A newer version of this scope exists. Open it to decide; your comment is kept on this device.', code: 'replaced', ...await newerPointer(row.project_id, row.latest)}, 409);
  if (input.data.version !== row.version) return json({error: 'Version mismatch. Reload this review.', code: 'version_mismatch'}, 409);
  if (row.status !== 'pending') return json({error: 'This version already has a decision.', code: 'already_decided'}, 409);
  // L1: the page computes canonical(content) of what it rendered; it must equal the stored content.
  const contentHash = await sha256(canonical(JSON.parse(row.content)));
  if (input.data.content_sha256 !== contentHash) return json({error: 'This version changed or did not load completely. Reload this review before deciding.', code: 'content_changed'}, 409);
  // PR B + M14: the one-time code, when required, is bound to this decision and used once.
  const proof = await checkDecisionProof({versionId: row.id, requireOtp: !!row.require_otp, otpSession: input.data.otp_session, action: 'decision'});
  if (!proof.ok) return json({error: proof.error, code: proof.code}, proof.status);
  const evidence = proof.evidence;
  const decided = new Date().toISOString();
  const anchor = await anchorOf({project_id: row.project_id, version: row.version, content: row.content, signer: input.data.signer, decided});
  const signature = signRecord(anchorMessage(anchor));
  if (!signature && signingBlocked()) return signingUnavailable();
  const evidenceSignature = evidence ? await signEvidence(anchor, evidence) : null;
  const context = await decisionContext(request, row.owner, {acknowledged: true, content_sha256: contentHash, ...(evidence ? {identity: evidence, identity_signature: evidenceSignature, contact_since: row.contact_since ?? null} : {})});
  const before = await db().prepare("SELECT MAX(version) AS v FROM versions WHERE project_id=? AND status='approved'").bind(row.project_id).first<{v: number | null}>();
  const r = await db().prepare("UPDATE versions SET status=?,signer=?,comment=?,decided=?,signature=?,decision_context=? WHERE id=? AND token=? AND revoked=0 AND status='pending' AND version=(SELECT latest FROM projects WHERE id=versions.project_id)").bind(input.data.decision, input.data.signer, input.data.comment, decided, signature, JSON.stringify(context), row.id, token).lock('scopeflow:project:' + row.project_id).run();
  if (!r.meta.changes) return json({error: 'This version already has a decision or has been replaced. Ask the creator for the latest link.', code: 'already_decided'}, 409);
  // A decided version was evidently sent: lock the contact (C5) and freeze its countersigning roles (M17).
  await markSent(row.project_id, row.version, 'decision', decided);
  let title = '';
  try { title = String((JSON.parse(row.content) as {title?: string}).title ?? ''); } catch { title = ''; }
  after(() => { void notify('client_decision', {project_id: row.project_id, data: {decision: input.data.decision, signer: input.data.signer, version: row.version, comment: input.data.comment, title}}); });
  if (input.data.decision === 'approved') {
    // WS-05: the new baseline replaces the previous approved one (baseline_superseded).
    try { await onBaselineApproved(row.project_id, before?.v ?? null, row.version); } catch (e) { console.error('Scopeflow onBaselineApproved failed', e instanceof Error ? e.message : 'unknown'); }
    after(() => inviteCosigners(request, row.project_id, row.version, row.owner, (JSON.parse(row.content) as {title: string}).title));
  }
  // RFC 3161: an independent timestamp authority dates the decision's fingerprint (when configured), after the response.
  after(() => timestampRecord(row.project_id, row.version, 'decision', anchor));
  const recorded = {...row, status: input.data.decision, signer: input.data.signer, decided, signature, decision_context: JSON.stringify(context)};
  // SF-04: a receipt the client can keep; it lets them detect any later rewrite.
  return json({status: input.data.decision, receipt: {project_id: row.project_id, version: row.version, signer: input.data.signer, decided, content_sha256: contentHash, anchor, signature, key: publicSigningKey(), ...(evidence ? {identity: evidence, identity_signature: evidenceSignature} : {})}, evidence: await recordEvidence(recorded)});
}
