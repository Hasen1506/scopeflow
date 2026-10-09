import {createHash} from 'node:crypto';
import {db, json, ownerAuth, allowRead, parseRow, failure} from '@/lib/server';
import {loadLedger, anchorOf} from '@/lib/ledger-server';
import {verifyChain} from '@/lib/ledger';
import {receiptModel, receiptTimeZone, type DecidedRow} from '@/lib/receipt-server';
import {renderReceiptPdf} from '@/lib/receipt';
import {renderStatementPdf, statementModel} from '@/lib/statement';
import {renderInvoicePdf, type InvoiceContent} from '@/lib/invoice';
import {publicSigningKey} from '@/lib/signing';
import {maybeSignPdf} from '@/lib/pades';
import {timestampRecord, timestampsFor} from '@/lib/timestamps';
import {packReadme, renderSection63Pdf, type PackFile} from '@/lib/dispute';
import {publicUrl} from '@/lib/origin';
import {zip, type ZipEntry} from '@/lib/zip';
import {ensurePdfFonts} from '@/lib/pdf-fonts';
import type {Scope} from '@/lib/scope';
type Ctx = {params: Promise<{id: string}>};

const sha = (b: Uint8Array | string) => createHash('sha256').update(b).digest('hex');

// Dispute pack: one ZIP with every receipt, the statement, issued invoices, the full ledger with a
// chain proof, RFC 3161 tokens, a pre-filled BSA 2023 s.63 certificate and SHA-256 sums. Owner only.
export async function GET(request: Request, ctx: Ctx) {
  try {
    const auth = await ownerAuth(request);
    if (!auth) return json({error: 'Sign in or provide a valid API token.'}, 401);
    if (!await allowRead('owner:' + auth.user, 20)) return json({error: 'Too many requests. Try again in a minute.'}, 429);
    const {id} = await ctx.params;
    const project = await db().prepare('SELECT id,timezone FROM projects WHERE id=? AND owner=?').bind(id, auth.user).first<{id: string; timezone: string | null}>();
    if (!project) return json({error: 'Project not found.'}, 404);
    const versions = (await db().prepare('SELECT * FROM versions WHERE project_id=? ORDER BY version').bind(id).all<DecidedRow & {created: string}>()).results;
    const ledger = await loadLedger(id);
    const latest = versions.at(-1)!;
    const content = JSON.parse(latest.content) as Scope;
    const generated = new Date().toISOString();
    await ensurePdfFonts();
    // A fresh RFC 3161 timestamp over the current ledger head (when an authority is configured).
    if (ledger.entries.length) await timestampRecord(id, ledger.entries.at(-1)!.baseline_version, `ledger:${ledger.entries.length}`, ledger.head);
    const files: (ZipEntry & {description: string})[] = [];
    for (const v of versions) {
      if (v.status === 'pending' || !v.decided) continue;
      const pdf = await maybeSignPdf(renderReceiptPdf(await receiptModel(request, {...v, timezone: project.timezone})));
      files.push({name: `receipt-v${v.version}.pdf`, data: pdf, description: `Decision receipt, version ${v.version} (${v.status})`});
    }
    if (ledger.baseline && ledger.content && ledger.agreement) {
      const pdf = await maybeSignPdf(renderStatementPdf(statementModel({project_id: id, version: ledger.baseline.version, content: ledger.content, agreement: ledger.agreement, entries: ledger.entries, time_zone: receiptTimeZone(request, project.timezone), generated})));
      files.push({name: 'statement.pdf', data: pdf, description: 'Statement of account for the current agreement'});
    }
    for (const inv of (await db().prepare('SELECT number,content FROM invoices WHERE project_id=? AND owner=? ORDER BY seq').bind(id, auth.user).all<{number: string; content: string}>()).results)
      files.push({name: `invoices/${inv.number.replace(/[^A-Za-z0-9._-]/g, '-')}.pdf`, data: await maybeSignPdf(renderInvoicePdf(JSON.parse(inv.content) as InvoiceContent)), description: `Invoice ${inv.number}`});
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
    const bytes = zip([{name: 'README.txt', data: packReadme(model)}, ...files, {name: 'section63-certificate.pdf', data: certificate}, {name: 'SHA256SUMS.txt', data: sums}], new Date(generated));
    return new Response(Buffer.from(bytes), {status: 200, headers: {'Content-Type': 'application/zip', 'Content-Disposition': `attachment; filename="scopeflow-dispute-pack-${id.slice(0, 12)}.zip"`, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff'}});
  } catch (e) { return failure(e); }
}
