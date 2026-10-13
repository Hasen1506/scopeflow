// PR A regression suite: server-generated PDF receipts and the public /verify check.
// Local-only: disposable fixtures in the local test database and auth fixture.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import jsQR from 'jsqr';
import {signIn, ack} from './support/local.mjs';
const base = process.env.SCOPEFLOW_TEST_URL || 'http://localhost:5173';
assert.equal(new URL(base).hostname, 'localhost', 'Local fixtures only.');
let passed = 0;
const ok = (value, message) => { assert.ok(value, message); passed++; };
const eq = (a, b, message) => { assert.deepEqual(a, b, message); passed++; };
async function call(path, {method = 'GET', cookie, body, headers = {}} = {}) {
  const h = {...headers, Origin: base};
  if (cookie) h.Cookie = cookie;
  if (body !== undefined) h['Content-Type'] = 'application/json';
  const r = await fetch(base + path, {method, headers: h, body: body === undefined ? undefined : JSON.stringify(body)});
  const buffer = Buffer.from(await r.arrayBuffer());
  let data; try { data = JSON.parse(buffer.toString('utf8')); } catch { data = buffer; }
  return {status: r.status, data, headers: r.headers};
}
const scope = () => ({title: 'Receipt fixture ' + randomUUID().slice(0, 8), client: 'Fictional Client', deliverables: '', items: [{id: 'i_logo', title: 'Logo suite', qty: 1, unit: '', price: 500, acceptance: 'SVG'}], client_inputs: [], exclusions: 'Website', fee: 500, currency: 'USD', revisions: 2, due: '2027-01-31', notes: 'Fixture.'});

/** Rebuilds the QR modules drawn between the % qr-begin / % qr-end markers and decodes them. */
function decodeQr(pdf) {
  const block = /% qr-begin (\d+) ([\d.]+) ([\d.]+) ([\d.]+)\n([\s\S]*?)% qr-end/.exec(pdf);
  if (!block) return null;
  const size = Number(block[1]), x0 = Number(block[2]), top = Number(block[3]), cell = Number(block[4]);
  const scale = 4, quiet = 4, px = (size + quiet * 2) * scale, rgba = new Uint8ClampedArray(px * px * 4).fill(255);
  for (const m of block[5].matchAll(/([\d.]+) ([\d.]+) ([\d.]+) ([\d.]+) re f/g)) {
    const r = Math.round((top - Number(m[2])) / cell) - 1, c0 = Math.round((Number(m[1]) - x0) / cell), len = Math.round(Number(m[3]) / cell);
    for (let c = c0; c < c0 + len; c++) for (let dy = 0; dy < scale; dy++) for (let dx = 0; dx < scale; dx++) { const i = (((r + quiet) * scale + dy) * px + (c + quiet) * scale + dx) * 4; rgba[i] = rgba[i + 1] = rgba[i + 2] = 0; }
  }
  return jsQR(rgba, px, px)?.data ?? null;
}

const cookie = await signIn(base, `receipt-${Date.now()}@example.test`);
const other = await signIn(base, `receipt-other-${Date.now()}@example.test`);
const created = await call('/api/scopes', {method: 'POST', cookie, body: scope()});
eq(created.status, 201);
const {project_id} = created.data.scope, token = created.data.scope.token;

// No decision yet: no receipt, and the verify check discloses nothing.
{
  const r = await call(`/api/review/${token}/receipt`);
  eq(r.status, 409); eq(r.data.code, 'no_decision');
  eq((await call(`/api/scopes/${project_id}/receipt?version=1`, {cookie})).status, 409);
  eq((await call(`/api/verify?p=${project_id}&v=1&a=${'0'.repeat(64)}`)).data, {record: 'not_found', signature: null, details: null});
}

// Approve, then download the client's receipt.
const decision = await call('/api/review/' + token, {method: 'POST', body: await ack(base, token, {decision: 'approved', signer: 'Ada Client', comment: '', version: 1})});
eq(decision.status, 200);
const {anchor, signature, content_sha256} = decision.data.receipt;
{
  const r = await call(`/api/review/${token}/receipt?tz=Asia/Kolkata`);
  eq(r.status, 200);
  eq(r.headers.get('content-type'), 'application/pdf');
  ok(/^attachment; filename="scopeflow-receipt-[A-Za-z0-9-]+-v1\.pdf"$/.test(r.headers.get('content-disposition')), r.headers.get('content-disposition'));
  eq(r.headers.get('cache-control'), 'no-store');
  const pdf = r.data.toString('latin1');
  ok(pdf.startsWith('%PDF-1.4') && pdf.endsWith('%%EOF\n'), 'a complete PDF');
  for (const needle of [anchor, content_sha256, 'Ada Client', 'Asia/Kolkata', 'GMT+5:30', signature.slice(0, 40), 'Logo suite']) ok(pdf.includes(needle), 'PDF includes ' + needle);
  eq(decodeQr(pdf), `${base}/verify?p=${project_id}&v=1&a=${anchor}`);
  // An invalid zone falls back to UTC instead of failing.
  const utc = await call(`/api/review/${token}/receipt?tz=Mars/Olympus`);
  eq(utc.status, 200); ok(!utc.data.toString('latin1').includes('GMT+'), 'UTC only');
}

// Without a tz parameter the receipt uses the project's time zone (the zone the review page and
// workspace show every time in), not UTC. An explicit valid tz still wins.
{
  eq((await call(`/api/scopes/${project_id}`, {method: 'PATCH', cookie, body: {timezone: 'Asia/Kolkata'}})).data.project.timezone, 'Asia/Kolkata');
  const client = (await call(`/api/review/${token}/receipt`)).data.toString('latin1');
  ok(client.includes('Asia/Kolkata') && client.includes('GMT+5:30'), 'client receipt defaults to the project time zone');
  const owner = (await call(`/api/scopes/${project_id}/receipt?version=1`, {cookie})).data.toString('latin1');
  ok(owner.includes('Asia/Kolkata') && owner.includes('GMT+5:30'), 'owner receipt defaults to the project time zone');
  const tokyo = (await call(`/api/review/${token}/receipt?tz=Asia/Tokyo`)).data.toString('latin1');
  ok(tokyo.includes('Asia/Tokyo') && !tokyo.includes('Asia/Kolkata'), 'an explicit tz overrides the project zone');
  const invalid = (await call(`/api/review/${token}/receipt?tz=Mars/Olympus`)).data.toString('latin1');
  ok(invalid.includes('Asia/Kolkata'), 'an invalid tz falls back to the project zone');
  eq((await call(`/api/scopes/${project_id}`, {method: 'PATCH', cookie, body: {timezone: ''}})).data.project.timezone, null);
}

// The owner's copy: session only for their own project.
{
  const r = await call(`/api/scopes/${project_id}/receipt?version=1`, {cookie});
  eq(r.status, 200); ok(r.data.toString('latin1').includes(anchor));
  eq((await call(`/api/scopes/${project_id}/receipt`, {cookie})).status, 200); // latest decided by default
  eq((await call(`/api/scopes/${project_id}/receipt?version=1`)).status, 401);
  eq((await call(`/api/scopes/${project_id}/receipt?version=1`, {cookie: other})).status, 404);
  eq((await call(`/api/scopes/${project_id}/receipt?version=abc`, {cookie})).status, 400);
}

// Public verification behind the QR code.
{
  const good = await call(`/api/verify?p=${project_id}&v=1&a=${anchor}`);
  eq(good.status, 200);
  eq(good.data.record, 'match'); eq(good.data.signature, 'valid');
  eq(good.data.details.signer, 'Ada Client'); eq(good.data.details.content_sha256, content_sha256); eq(good.data.details.signature, signature);
  const wrong = await call(`/api/verify?p=${project_id}&v=1&a=${anchor.replace(/^./, c => (c === 'a' ? 'b' : 'a'))}`);
  eq(wrong.data, {record: 'mismatch', signature: null, details: null});
  eq((await call(`/api/verify?p=${project_id}&v=2&a=${anchor}`)).data.record, 'not_found');
  eq((await call(`/api/verify?p=${project_id}&v=1&a=nothex`)).status, 400);
  eq((await call(`/api/verify?p=${encodeURIComponent("x' OR 1=1")}&v=1&a=${anchor}`)).status, 400);
  const page = await fetch(`${base}/verify?p=${project_id}&v=1&a=${anchor}`);
  eq(page.status, 200);
}

// changed by WS-02 (H4, §6.3): revoking a decided version stops new actions, but the client keeps
// their copy: the read-only link still serves the receipt. The owner still can too.
{
  eq((await call(`/api/scopes/${project_id}/review-link`, {method: 'POST', cookie, body: {version: 1, action: 'revoke'}})).status, 200);
  eq((await call(`/api/review/${token}/receipt`)).status, 200);
  eq((await call(`/api/scopes/${project_id}/receipt?version=1`, {cookie})).status, 200);
  eq((await call(`/api/review/${'z'.repeat(64)}/receipt`)).status, 404);
}
console.log(`receipt: ${passed} checks passed`);
