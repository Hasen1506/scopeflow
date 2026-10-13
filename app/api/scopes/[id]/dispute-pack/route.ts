import {createHash} from 'node:crypto';
import {db, json, ownerAuth, allowRead, parseRow, failure} from '@/lib/server';
import {loadLedger, anchorOf} from '@/lib/ledger-server';
import {describeEntry, paymentsOf, verifyChain} from '@/lib/ledger';
import {receiptModel, receiptTimeZone, type DecidedRow} from '@/lib/receipt-server';
import {renderReceiptPdf} from '@/lib/receipt';
import {renderStatementPdf, statementModel} from '@/lib/statement';
import {renderInvoicePdf, fromMinorOf, toMinorOf} from '@/lib/invoice';
import {renderCreditNotePdf} from '@/lib/credit-note';
import {renderReceiptVoucherPdf} from '@/lib/receipt-voucher';
import {publicSigningKey} from '@/lib/signing';
import {maybeSignPdf} from '@/lib/pades';
import {timestampRecord, timestampsFor} from '@/lib/timestamps';
import {consumerPackManifest, consumerSummary, csv, MSMED_PACK_FILES, packReadme, renderSection63Pdf, samadhaanFieldSheet, type PackFile, type PackVariant} from '@/lib/dispute';
import {publicUrl} from '@/lib/origin';
import {zip, type ZipEntry} from '@/lib/zip';
import {ensurePdfFonts} from '@/lib/pdf-fonts';
import {currentMode} from '@/lib/mode';
import {formatMoney} from '@/lib/currency';
import {stateName} from '@/lib/gst';
import {invoicingState, msmedSummary, type ProjectRow} from '@/lib/invoice-server';
import {statementBilling} from '@/lib/invoice-api';
import {interestCsv, msmedDueDates, msmedInterest, RBI_BANK_RATE, acceptanceDay} from '@/lib/msmed';
import type {Scope} from '@/lib/scope';
type Ctx = {params: Promise<{id: string}>};

const sha = (b: Uint8Array | string) => createHash('sha256').update(b).digest('hex');
const VARIANTS: PackVariant[] = ['standard', 'msmed', 'consumer'];

// Dispute pack: one ZIP with every receipt, the statement, issued invoices, the full ledger with a
// chain proof, RFC 3161 tokens, a pre-filled BSA 2023 s.63 certificate and SHA-256 sums. Owner only.
// WS-03: ?variant=msmed adds the MSME Samadhaan field sheet, the s.16 interest worksheet and the
// acceptance evidence (SF-07); ?variant=consumer is the homeowner's evidence pack for a Consumer
// Protection Act 2019 complaint on e-Daakhil (SF-24; the default in Consumer mode).
export async function GET(request: Request, ctx: Ctx) {
  try {
    const auth = await ownerAuth(request);
    if (!auth) return json({error: 'Sign in or provide a valid API token.'}, 401);
    if (!await allowRead('owner:' + auth.user, 20)) return json({error: 'Too many requests. Try again in a minute.'}, 429);
    const {id} = await ctx.params;
    const project = await db().prepare('SELECT id,owner,timezone,client_email,client_gstin,client_state,client_address FROM projects WHERE id=? AND owner=?').bind(id, auth.user).first<ProjectRow>();
    if (!project) return json({error: 'Project not found.'}, 404);
    const asked = new URL(request.url).searchParams.get('variant');
    if (asked && !VARIANTS.includes(asked as PackVariant)) return json({error: 'variant must be standard, msmed or consumer.'}, 400);
    const variant: PackVariant = (asked as PackVariant | null) ?? ((await currentMode(auth.user)) === 'consumer' ? 'consumer' : 'standard');
    const versions = (await db().prepare('SELECT * FROM versions WHERE project_id=? ORDER BY version').bind(id).all<DecidedRow & {created: string}>()).results;
    const ledger = await loadLedger(id);
    const latest = versions.at(-1)!;
    const content = JSON.parse(latest.content) as Scope;
    const generated = new Date().toISOString();
    await ensurePdfFonts();
    const s = await invoicingState(project, ledger);
    if (variant === 'msmed' && !s.msme) return json({error: 'Add your Udyam registration (number, date and category) in the invoicing terms first: the MSMED pack is built from it.', code: 'udyam_required'}, 409);
    // A fresh RFC 3161 timestamp over the current ledger head (when an authority is configured).
    if (ledger.entries.length) await timestampRecord(id, ledger.entries.at(-1)!.baseline_version, `ledger:${ledger.entries.length}`, ledger.head);
    const files: (ZipEntry & {description: string})[] = [];
    const receiptDir = variant === 'consumer' ? 'acceptance/' : '';
    for (const v of versions) {
      if (v.status === 'pending' || !v.decided) continue;
      const pdf = await maybeSignPdf(renderReceiptPdf(await receiptModel(request, {...v, timezone: project.timezone})));
      files.push({name: `${receiptDir}receipt-v${v.version}.pdf`, data: pdf, description: `Decision receipt, version ${v.version} (${v.status})`});
    }
    if (ledger.baseline && ledger.content && ledger.agreement) {
      const billing = s.docs.invoices.length || s.docs.vouchers.length ? statementBilling(s) : undefined;
      const kind = s.agreement && s.agreement.kind !== 'single' ? s.agreement.kind : undefined;
      const pdf = await maybeSignPdf(renderStatementPdf(statementModel({project_id: id, version: ledger.baseline.version, content: ledger.content, agreement: ledger.agreement, entries: ledger.entries, time_zone: receiptTimeZone(request, project.timezone), generated, kind, billing})));
      files.push({name: 'statement.pdf', data: pdf, description: 'Statement of account for the current agreement'});
    }
    for (const inv of s.docs.invoices)
      files.push({name: `invoices/${inv.row.number.replace(/[^A-Za-z0-9._-]/g, '-')}.pdf`, data: await maybeSignPdf(renderInvoicePdf(inv.content, null, {cancelled_by: inv.cancelled_by})), description: `Invoice ${inv.row.number}${inv.cancelled_by.length ? ` (cancelled by ${inv.cancelled_by.join(', ')})` : ''}`});
    for (const c of s.docs.credits) files.push({name: `credit-notes/${c.number}.pdf`, data: await maybeSignPdf(renderCreditNotePdf(c.content)), description: `Credit note ${c.number} against ${c.content.invoice.number}`});
    for (const v of s.docs.vouchers) files.push({name: `receipt-vouchers/${v.number}.pdf`, data: await maybeSignPdf(renderReceiptVoucherPdf(v.content)), description: `${v.content.kind === 'receipt_voucher' ? 'Receipt voucher' : 'Payment receipt'} ${v.number} for an advance`});

    const money = (v: number) => formatMoney(v, s.currency);
    if (variant === 'msmed') {
      const m = msmedSummary({profile: s.msme, contract_date: ledger.baseline?.decided ?? null, acceptances: s.docs.acceptances, terms: s.terms, views: s.views, currency: s.currency, today: s.today});
      const accepted = s.docs.acceptances.at(-1) ?? null;
      const due = m.acceptance?.day ? msmedDueDates(m.acceptance.day, s.terms.msmed_agreed_days) : null;
      const outstanding = s.views.filter(v => v.status !== 'cancelled').reduce((t, v) => t + v.open, 0);
      const interest = due && s.today > due.pay_by ? msmedInterest({principal: toMinorOf(outstanding, s.currency), interest_from: due.interest_from, paid_on: s.today, rate_basis: s.terms.msmed_rate_basis}) : null;
      const warnings = [...m.warnings.map(w => w.message), ...(m.acceptance?.day ? [] : ['No acceptance date is on the record: record delivery and acceptance so the due date and interest can be computed.'])];
      const interestTotal = interest ? fromMinorOf(interest.interest, s.currency) : 0;
      files.push({name: 'msme-samadhaan-field-sheet.txt', description: MSMED_PACK_FILES[0].description, data: samadhaanFieldSheet({
        supplier: {name: s.profile.business_name, address: s.profile.business_address, gstin: s.profile.tax_id, udyam_number: s.msme!.udyam_number, category: s.msme!.category, registered_on: s.msme!.registered_on, email: ''},
        buyer: {name: content.client, email: project.client_email ?? '', gstin: project.client_gstin ?? '', address: project.client_address ?? '', state: project.client_state ? stateName(project.client_state) : ''},
        project: {id, title: content.title, agreement_date: ledger.baseline?.decided ?? null},
        acceptance: {day: m.acceptance?.day ?? null, basis: m.acceptance?.basis ?? 'pending', delivered_on: m.acceptance?.delivered_on ?? null},
        pay_by: due?.pay_by ?? null, agreed_days: s.terms.msmed_agreed_days, rate_basis: s.terms.msmed_rate_basis,
        invoices: s.views.filter(v => v.status !== 'cancelled').map(v => ({number: v.number, issued: v.issued, amount: money(v.amount), received: money(v.covered), outstanding: money(v.open), interest: money(m.invoices.find(x => x.seq === v.seq)?.interest ?? 0)})),
        totals: {outstanding: money(outstanding), interest: money(interestTotal), claimed: money(outstanding + interestTotal)},
        warnings, generated,
      })});
      files.push({name: 'msmed-interest.csv', description: MSMED_PACK_FILES[1].description, data: interest ? interestCsv(interest, s.currency) : 'No interest: the payment is not overdue under MSMED s.15, or no acceptance date is recorded.\n'});
      files.push({name: 'msmed-interest.json', description: MSMED_PACK_FILES[2].description, data: JSON.stringify({estimate: 'Estimate — confirm with your CA.', principal_outstanding: outstanding, acceptance: m.acceptance, pay_by: due?.pay_by ?? null, interest_from: due?.interest_from ?? null, rate_basis: s.terms.msmed_rate_basis, computation: interest, bank_rate_table: RBI_BANK_RATE, warnings}, null, 2)});
      files.push({name: 'acceptance.json', description: MSMED_PACK_FILES[3].description, data: JSON.stringify({current: accepted ? {...accepted, acceptance: acceptanceDay(accepted, s.today)} : null, history: s.docs.acceptances}, null, 2)});
    }
    if (variant === 'consumer') {
      const a = ledger.agreement, lines = paymentsOf(ledger.entries).lines;
      files.push({name: 'scope.json', description: 'The agreed scope / BOQ (bill of quantities) as approved', data: JSON.stringify(ledger.content ?? content, null, 2)});
      files.push({name: 'change-orders.csv', description: 'Every change order with its status, amount and who decided it', data: csv([['seq', 'title', 'status', 'fee_delta', 'days_delta', 'decided_by', 'decided_at'], ...(a?.change_orders ?? []).map(c => [c.seq, c.title, c.status, c.fee_delta, c.days_delta, c.settled_by, c.settled_at ?? ''])])});
      files.push({name: 'payments.csv', description: 'Stage payments and refunds with dates, methods and UTR / references', data: csv([['date', 'amount', 'method', 'utr_or_reference', 'note', 'record_entry'], ...lines.map(l => [l.received, l.amount, l.method, l.reference, l.note, l.seq])])});
      const inspections = ledger.entries.filter(e => e.kind === 'client_input' || e.kind === 'revision_round').map(e => ({date: e.created.slice(0, 10), what: describeEntry(e, content.currency)}));
      files.push({name: 'inspections.csv', description: 'Inspection sign-offs and inputs recorded on the agreement', data: csv([['date', 'what'], ...inspections.map(i => [i.date, i.what])])});
      files.push({name: 'timeline.txt', description: 'Timeline of the record, oldest first', data: [...versions.map(v => `${(v.decided ?? v.created).slice(0, 16)}  Version ${v.version} ${v.status}${v.signer ? ` by ${v.signer}` : ''}`), ...ledger.entries.map(e => `${e.created.slice(0, 16)}  ${describeEntry(e, content.currency)}`)].sort().join('\n') + '\n'});
      const total = s.cap ? fromMinorOf(s.cap.agreement_total, s.currency) : 0, paid = Math.round(lines.reduce((t, l) => t + l.amount, 0) * 100) / 100;
      files.unshift({name: 'summary.txt', description: 'Plain-language summary of the dispute (what was agreed, paid and changed)', data: consumerSummary({
        title: content.title, vendor: s.profile.business_name || 'The vendor', homeowner: content.client, agreed_on: ledger.baseline?.decided ?? null, currency_total: money(total), paid: money(paid), balance: money(Math.max(0, total - paid)),
        change_orders: (a?.change_orders ?? []).map(c => ({title: c.title, status: c.status, amount: money(c.fee_delta)})),
        payments: lines.map(l => ({date: l.received, amount: money(l.amount), method: l.method, reference: l.reference})), inspections, photos: 0, generated,
      })});
    }
    const exported = {exported_at: generated, format_version: 1, project_id: id, versions: versions.map(v => parseRow(v as unknown as Record<string, unknown>, {withToken: false})), ledger_entries: ledger.entries};
    files.push({name: 'records.json', data: JSON.stringify(exported, null, 2), description: 'Every version, decision and ledger entry (JSON)'});
    const anchors: Record<number, string> = {};
    for (const v of versions) if (v.status === 'approved') anchors[v.version] = await anchorOf(v);
    const chain = await verifyChain(ledger.entries, anchors);
    files.push({name: 'chain-proof.json', data: JSON.stringify({
      anchors, anchor_signatures: Object.fromEntries(versions.filter(v => v.status !== 'pending').map(v => [v.version, v.signature ?? null])),
      entries: ledger.entries.map(({seq, kind, baseline_version, actor, created, payload_hash, prev_hash, hash, signature}) => ({seq, kind, baseline_version, actor, created, payload_hash, prev_hash, hash, signature})),
      verification: chain, seal: ledger.seal.state, public_key: publicSigningKey(),
      formulas: {anchor: 'sha256("scopeflow-baseline-v1|" + project_id + "|" + version + "|" + JSON(content) + "|" + signer + "|" + decided)', entry: 'sha256("scopeflow-entry-v1|" + prev_hash + "|" + seq + "|" + kind + "|" + baseline_version + "|" + anchor + "|" + actor + "|" + created + "|" + payload_hash)', signatures: 'Ed25519 over "scopeflow-anchor-v1:" + anchor and "scopeflow-entry-v1:" + hash'},
    }, null, 2), description: 'Fingerprints, signatures and the chain check'});
    const stamps = (await Promise.all(versions.map(v => timestampsFor(id, v.version)))).flat();
    for (const t of stamps) files.push({name: `timestamps/${t.subject.replace(/[^A-Za-z0-9_-]/g, '-')}-${t.digest.slice(0, 12)}.tst`, data: Buffer.from(t.token, 'base64'), description: `RFC 3161 token by ${t.tsa} at ${t.gen_time} over ${t.digest.slice(0, 16)}…`});
    const listed: PackFile[] = files.map(f => ({name: f.name, sha256: sha(f.data), bytes: typeof f.data === 'string' ? Buffer.byteLength(f.data) : f.data.length, description: f.description}));
    const model = {project_id: id, title: content.title, client: content.client, origin: publicUrl(request, '/').replace(/\/$/, ''), generated, versions: versions.length, decided: versions.filter(v => v.decided).length, entries: ledger.entries.length, ledger_head: ledger.entries.length ? ledger.head : null, files: listed};
    const certificate = await maybeSignPdf(renderSection63Pdf(model));
    const sums = [...listed, {name: 'section63-certificate.pdf', sha256: sha(certificate)}].map(f => `${f.sha256}  ${f.name}`).join('\n') + '\n';
    const extra: ZipEntry[] = variant === 'consumer' ? [{name: 'MANIFEST.txt', data: consumerPackManifest().map(e => `${e.name.padEnd(28)} ${e.description}`).join('\n') + '\n'}] : [];
    const bytes = zip([{name: 'README.txt', data: packReadme(model)}, ...extra, ...files, {name: 'section63-certificate.pdf', data: certificate}, {name: 'SHA256SUMS.txt', data: sums}], new Date(generated));
    const suffix = variant === 'standard' ? '' : `-${variant}`;
    return new Response(Buffer.from(bytes), {status: 200, headers: {'Content-Type': 'application/zip', 'Content-Disposition': `attachment; filename="scopeflow-dispute-pack${suffix}-${id.slice(0, 12)}.zip"`, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff'}});
  } catch (e) { return failure(e); }
}
