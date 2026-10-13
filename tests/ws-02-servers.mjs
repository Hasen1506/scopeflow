// WS-02 suites that need a server started with a different configuration than CI's main one. Two
// extra `next start` processes on the same production build, database and auth fixture:
//   B (:5181) NODE_ENV=production with no SCOPEFLOW_SIGNING_SECRET: every signing path fails closed (C1).
//   C (:5182) the eSign test double (SF-15) and the cookie-derived key allow-listed (C6).
// Both are stopped at the end, pass or fail. Local fixtures and TEST data only.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {randomUUID, createHmac} from 'node:crypto';
import {signIn, ack, localSql} from './support/local.mjs';
import './support/ts-resolve.mjs';

const main = process.env.SCOPEFLOW_TEST_URL || 'http://localhost:5173';
assert.equal(new URL(main).hostname, 'localhost', 'Local fixtures only.');
let passed = 0;
const eq = (a, b, m) => { assert.deepEqual(a, b, m); passed++; };
const ok = (v, m) => { assert.ok(v, m); passed++; };
const q = s => `'${String(s).replaceAll("'", "''")}'`;
const S = await import('../lib/signing.ts');
const L = await import('../lib/ledger.ts');
const DOUBLE_SECRET = 'ci-only-esign-double-secret-0123456789';

const children = [];
async function start(port, env) {
  const child = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '--hostname', 'localhost', '--port', String(port)], {env, stdio: ['ignore', 'pipe', 'pipe']});
  let log = '';
  child.stdout.on('data', d => { log += d; }); child.stderr.on('data', d => { log += d; });
  children.push(child);
  const url = `http://localhost:${port}`;
  for (let i = 0; i < 90; i++) {
    try { const r = await fetch(url + '/api/signing-key'); if (r.status === 200) return url; } catch { /* starting */ }
    await new Promise(r => setTimeout(r, 1000));
  }
  throw new Error(`server on ${port} did not start:\n${log.slice(-2000)}`);
}
const stopAll = () => { for (const c of children) { try { c.kill('SIGTERM'); } catch { /* gone */ } } };

function client(base, cookie) {
  return async (path, {method = 'GET', body, headers = {}, raw = false, auth = true} = {}) => {
    const h = {Origin: main, ...headers};
    if (cookie && auth) h.Cookie = cookie;
    if (body !== undefined && typeof body !== 'string') h['Content-Type'] = 'application/json';
    const r = await fetch(base + path, {method, headers: h, body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body)});
    if (raw) return {status: r.status, bytes: Buffer.from(await r.arrayBuffer())};
    const text = await r.text(); let data; try { data = JSON.parse(text); } catch { data = text; }
    return {status: r.status, data};
  };
}
const content = () => ({title: 'TEST WS-02 servers ' + randomUUID().slice(0, 8), client: 'Fictional Client', deliverables: '', items: [{id: 'i_logo', title: 'Logo suite', qty: 1, unit: '', price: 1000, acceptance: ''}], client_inputs: [], exclusions: '', fee: 1000, currency: 'INR', revisions: 1, due: '', notes: ''});
const pdfText = bytes => [...bytes.toString('latin1').matchAll(/\((?:[^()\\]|\\[()\\]|\\[0-7]{3})*\) Tj/g)].map(m => m[0].slice(1, -4).replace(/\\([0-7]{3})/g, (_, o) => String.fromCharCode(parseInt(o, 8))).replace(/\\([()\\])/g, '$1')).join(' ');

try {
  const cookie = await signIn(main, `ws02-servers-${Date.now()}@example.test`);
  const A = client(main, cookie);

  // ---- C1: production without the dedicated secret creates no record ------------------------------
  // @covers C1
  {
    const env = {...process.env};
    delete env.SCOPEFLOW_SIGNING_SECRET; delete env.SCOPEFLOW_SIGNING_SECRET_PREVIOUS; delete env.SCOPEFLOW_ALLOW_COOKIE_SIGNING;
    const baseB = await start(5181, env);
    const B = client(baseB, cookie);
    const key = (await B('/api/signing-key')).data;
    eq([key.keys.length, key.signing], [0, 'off']);
    const created = await A('/api/scopes', {method: 'POST', body: content()});
    eq(created.status, 201);
    const {token, id, project_id} = created.data.scope;
    const before = localSql(`SELECT status,signer,decided,signature,decision_context FROM scopeflow.versions WHERE id=${q(id)}`)[0].results[0];
    const r = await B('/api/review/' + token, {method: 'POST', auth: false, body: await ack(main, token, {decision: 'approved', signer: 'Ada Client', comment: '', version: 1})});
    eq(r.status, 503); eq(r.data.code, 'signing_unavailable');
    ok(/can’t be signed right now; nothing was saved/.test(r.data.error), 'honest copy');
    eq(localSql(`SELECT status,signer,decided,signature,decision_context FROM scopeflow.versions WHERE id=${q(id)}`)[0].results[0], before);
    eq(Number(localSql(`SELECT COUNT(*) AS n FROM scopeflow.version_links WHERE project_id=${q(project_id)} AND first_sent IS NOT NULL`)[0].results[0].n), 0);
    // Countersignature and contact-change records fail closed too.
    eq((await A(`/api/scopes/${project_id}`, {method: 'PATCH', body: {cosigners: [{id: 'finance', role: 'Finance approver'}], client_email: 'c1@example.test'}})).status, 200);
    eq((await A('/api/review/' + token, {method: 'POST', body: await ack(main, token, {decision: 'approved', signer: 'Ada Client', comment: '', version: 1})})).status, 200);
    const link = (await A('/api/scopes/' + project_id)).data.cosign_links[0].cosign_path.split('/').pop();
    const sha = (await ack(main, token, {})).content_sha256;
    const cos = await B('/api/cosign/' + link, {method: 'POST', auth: false, body: {signer: 'Fin Ance', acknowledged: true, content_sha256: sha}});
    eq(cos.status, 503); eq(cos.data.code, 'signing_unavailable');
    eq(Number(localSql(`SELECT COUNT(*) AS n FROM scopeflow.version_cosigns WHERE project_id=${q(project_id)}`)[0].results[0].n), 0);
    const cc = await B(`/api/scopes/${project_id}/contact-change`, {method: 'POST', body: {email: 'c1.new@example.test', reason: 'TEST moved', confirm: true}});
    eq(cc.status, 503); eq(cc.data.code, 'signing_unavailable');
    eq(Number(localSql(`SELECT COUNT(*) AS n FROM scopeflow.contact_history WHERE project_id=${q(project_id)}`)[0].results[0].n), 0);
  }

  // ---- C (:5182): eSign double + cookie key allow-listed ----------------------------------------
  const cookieKid = S.cookieKeyId(process.env);
  const baseC = await start(5182, {...process.env, SCOPEFLOW_ESIGN_PROVIDER: 'double', SCOPEFLOW_ESIGN_DOUBLE_SECRET: DOUBLE_SECRET, SCOPEFLOW_LEGACY_KEY_IDS: cookieKid});
  const C = client(baseC, cookie);

  // @covers C6
  {
    const created = await A('/api/scopes', {method: 'POST', body: content()});
    const s = created.data.scope;
    const decided = new Date().toISOString();
    const stored = JSON.parse(localSql(`SELECT content FROM scopeflow.versions WHERE id=${q(s.id)}`)[0].results[0].content);
    const anchor = await L.anchorHash({project_id: s.project_id, version: 1, content: stored, signer: 'Legacy Client', decided});
    const saved = {...process.env};
    delete process.env.SCOPEFLOW_SIGNING_SECRET; process.env.NODE_ENV = 'development';
    const sig = S.signRecord(S.anchorMessage(anchor));
    for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
    Object.assign(process.env, saved);
    localSql(`UPDATE scopeflow.versions SET status='approved',signer='Legacy Client',decided=${q(decided)},signature=${q(sig)},comment='' WHERE id=${q(s.id)}`);
    const onMain = (await A(`/api/verify?p=${s.project_id}&v=1&a=${anchor}`)).data;
    ok(onMain.signature !== 'valid', 'not valid where the cookie key is not allow-listed');
    const listed = (await C(`/api/verify?p=${s.project_id}&v=1&a=${anchor}`)).data;
    eq([listed.record, listed.signature], ['match', 'legacy_key']);
    eq(listed.evidence.chip, 'Verified · older seal');
    ok((await C('/api/signing-key')).data.keys.some(k => k.kid === cookieKid && k.status === 'legacy'), 'the legacy key is published as legacy');
  }

  // @covers SF-15
  {
    const created = await C('/api/scopes', {method: 'POST', body: content()});
    eq(created.status, 201);
    const s = created.data.scope;
    eq((await C('/api/review/' + s.token, {method: 'POST', auth: false, body: await ack(main, s.token, {decision: 'approved', signer: 'Ada Client', comment: '', version: 1})})).status, 200);
    eq((await A(`/api/scopes/${s.project_id}/esign`, {method: 'POST', body: {version: 1}})).data.code, 'esign_unavailable'); // main server: provider off
    const req = await C(`/api/scopes/${s.project_id}/esign`, {method: 'POST', body: {version: 1}});
    eq(req.status, 201); eq(req.data.esign.status, 'requested');
    const docId = req.data.esign.document_id;
    eq((await C('/api/review/' + s.token, {auth: false})).data.esign.status, 'requested');
    const before = pdfText((await C(`/api/review/${s.token}/receipt`, {raw: true, auth: false})).bytes);
    ok(before.includes('Electronic acceptance (typed name + click)') && !before.includes('Aadhaar eSign'), 'no eSign wording before the callback');
    const signedPdf = Buffer.from('%PDF-1.4\n% TEST signed by the eSign double\n%%EOF\n');
    const payload = JSON.stringify({document_id: docId, status: 'signed', signed_pdf: signedPdf.toString('base64'), audit_trail: {events: ['TEST otp verified', 'TEST signed']}, signer_masked: 'XXXX-XXXX-1234'});
    eq((await C('/api/esign/double/callback', {method: 'POST', auth: false, body: payload, headers: {'Content-Type': 'application/json', 'X-Esign-Signature': 'f'.repeat(64)}})).status, 401);
    const cb = await C('/api/esign/double/callback', {method: 'POST', auth: false, body: payload, headers: {'Content-Type': 'application/json', 'X-Esign-Signature': createHmac('sha256', DOUBLE_SECRET).update(payload).digest('hex')}});
    eq(cb.status, 200); eq(cb.data.status, 'signed');
    const row = localSql(`SELECT status,signed_pdf,audit_trail FROM scopeflow.esign_records WHERE document_id=${q(docId)}`)[0].results[0];
    eq(row.status, 'signed'); eq(Buffer.from(row.signed_pdf, 'base64').toString('latin1'), signedPdf.toString('latin1'));
    ok(JSON.parse(row.audit_trail).events.length === 2, 'audit trail stored');
    const after = pdfText((await C(`/api/review/${s.token}/receipt`, {raw: true, auth: false})).bytes);
    ok(after.includes('Aadhaar eSign') && after.includes('Digitally signed PDF from double'), 'receipt wording switches to Aadhaar eSign');
    const view = (await C('/api/review/' + s.token, {auth: false})).data;
    eq(view.esign.status, 'signed');
    ok(view.evidence.seal.chip.endsWith('· Aadhaar eSign') && view.evidence.acceptance.startsWith('Aadhaar eSign'), 'client page wording switches');
  }
} finally {
  stopAll();
}
console.log(`ws-02-servers: ${passed} checks passed`);
