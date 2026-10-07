// PR A: the server-generated PDF receipt. Pure (no server): renders a receipt from fixed
// inputs on a frozen clock with a fixed signing key, then checks the PDF structure, the text
// it carries, that its QR code decodes to the public /verify URL, and byte-exact stability.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, writeFileSync, existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import jsQR from 'jsqr';
import {freezeClock, tick} from '../support/property.mjs';

process.env.SCOPEFLOW_SIGNING_SECRET = 'scopeflow-golden-signing-secret-do-not-use-0123456789';
delete process.env.SCOPEFLOW_SIGNING_SECRET_PREVIOUS;
freezeClock();
const {scopeSchema, sample} = await import('../../lib/scope.ts');
const {publicSigningKey} = await import('../../lib/signing.ts');
const {renderReceiptPdf, stamp, verifyUrl, qrMatrix, validTimeZone} = await import('../../lib/receipt.ts');
const {winAnsi, wrap} = await import('../../lib/pdf.ts');
const {approve} = await import('../support/chain.mjs');

const content = scopeSchema.parse({...sample, due: '2026-12-15', notes: 'Fees (excl. tax) are due in 15 days \\ net. Résumé “quotes” – ₹ ok.'});
const ids = {project_id: 'golden-project-0001', version: 1, signer: 'Ada Client', decided: tick(0)};
const b = await approve(content, ids);
const key = publicSigningKey();
const model = {
  project_id: b.project_id, version: 1, status: 'approved', content,
  content_sha256: createHash('sha256').update(JSON.stringify(content)).digest('hex'),
  signer: b.signer, decided: b.decided, comment: null, anchor: b.anchor, signature: b.signature,
  key: {kid: key.kid, x: key.x},
  context: {channel: 'review_link', ip: '203.0.113.7', user_agent: 'Mozilla/5.0 (Golden)', owner_session: false, via_api: false, acknowledged: true},
  ledger: {head: 'a'.repeat(64), count: 2},
  time_zone: 'Asia/Kolkata', generated: tick(60),
  verify_url: verifyUrl('https://scopeflow.example', b.project_id, 1, b.anchor),
};
const bytes = renderReceiptPdf(model);
const text = Buffer.from(bytes).toString('latin1');

/** Text drawn with Tj, decoded from PDF string escapes back to WinAnsi bytes. */
function drawnText(pdf) {
  return [...pdf.matchAll(/\((?:[^()\\]|\\[()\\]|\\[0-7]{3})*\) Tj/g)].map(m => m[0].slice(1, -4).replace(/\\([0-7]{3})/g, (_, o) => String.fromCharCode(parseInt(o, 8))).replace(/\\([()\\])/g, '$1')).join('\n');
}

test('PDF structure: header, objects, xref offsets and trailer are valid', () => {
  assert.ok(text.startsWith('%PDF-1.4\n'));
  assert.ok(text.endsWith('%%EOF\n'));
  const startxref = Number(/startxref\n(\d+)\n%%EOF\n$/.exec(text)[1]);
  assert.equal(text.slice(startxref, startxref + 4), 'xref');
  const [, count] = /xref\n0 (\d+)\n/.exec(text.slice(startxref)).map(Number);
  const offsets = [...text.slice(startxref).matchAll(/^(\d{10}) 00000 n $/gm)].map(m => Number(m[1]));
  assert.equal(offsets.length, count - 1);
  offsets.forEach((o, i) => assert.equal(text.slice(o, o + `${i + 1} 0 obj`.length), `${i + 1} 0 obj`, `object ${i + 1} offset`));
  for (const m of text.matchAll(/<< \/Length (\d+) >>\nstream\n/g)) {
    const start = m.index + m[0].length;
    assert.equal(text.slice(start + Number(m[1]), start + Number(m[1]) + 10), '\nendstream', 'stream length');
  }
});

test('PDF carries the signed scope, fingerprints, signature, signer and zoned timestamps', () => {
  const t = drawnText(text);
  for (const needle of [content.title, 'Ada Client', b.anchor, model.content_sha256, `kid ${key.kid}`, '203.0.113.7', 'Mozilla/5.0 (Golden)', 'Primary logo and two variations', '$1,800.00', '2026-10-07 09:00:00 UTC (2026-10-07 14:30:00 GMT+5:30, Asia/Kolkata)', 'Rs. ok', 'R\xe9sum\xe9 \x93quotes\x94 \x96']) {
    assert.ok(t.replace(/\n/g, ' ').includes(needle), `missing: ${needle}`);
  }
  assert.ok(t.replace(/\n/g, '').includes(b.signature), 'full signature (wrapped)');
  assert.match(t.replace(/\n/g, ' '), /aaaaaaaa+ \(2 entries\)/);
  assert.ok(/\/Subject \(anchor [0-9a-f]{64}\)/.test(text));
});

test('QR code drawn in the PDF decodes to the public /verify URL for this record', () => {
  const block = /% qr-begin (\d+) ([\d.]+) ([\d.]+) ([\d.]+)\n([\s\S]*?)% qr-end/.exec(text);
  assert.ok(block, 'QR block');
  const size = Number(block[1]), x0 = Number(block[2]), top = Number(block[3]), cell = Number(block[4]);
  const grid = Array.from({length: size}, () => new Array(size).fill(false));
  for (const m of block[5].matchAll(/([\d.]+) ([\d.]+) ([\d.]+) ([\d.]+) re f/g)) {
    const [x, y, w] = [Number(m[1]), Number(m[2]), Number(m[3])];
    const r = Math.round((top - y) / cell) - 1, c0 = Math.round((x - x0) / cell), len = Math.round(w / cell);
    for (let c = c0; c < c0 + len; c++) grid[r][c] = true;
  }
  assert.deepEqual(grid, qrMatrix(model.verify_url), 'drawn modules match the encoder');
  const scale = 4, quiet = 4, px = (size + quiet * 2) * scale, rgba = new Uint8ClampedArray(px * px * 4).fill(255);
  grid.forEach((row, r) => row.forEach((dark, c) => { if (!dark) return; for (let dy = 0; dy < scale; dy++) for (let dx = 0; dx < scale; dx++) { const i = (((r + quiet) * scale + dy) * px + (c + quiet) * scale + dx) * 4; rgba[i] = rgba[i + 1] = rgba[i + 2] = 0; } }));
  const decoded = jsQR(rgba, px, px);
  assert.equal(decoded?.data, `https://scopeflow.example/verify?p=golden-project-0001&v=1&a=${b.anchor}`);
});

test('deterministic and byte-exact (golden)', () => {
  assert.deepEqual(renderReceiptPdf(model), bytes);
  const file = new URL('./receipt-pdf.golden.json', import.meta.url);
  const value = JSON.stringify({sha256: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length}, null, 2) + '\n';
  if (process.env.UPDATE_GOLDEN === '1' || !existsSync(file)) writeFileSync(file, value);
  assert.equal(value, readFileSync(file, 'utf8'), 'receipt PDF changed; run with UPDATE_GOLDEN=1 only if intended');
});

test('long scopes flow onto further pages without losing text', () => {
  const long = scopeSchema.parse({...content, notes: Array.from({length: 60}, (_, i) => `Term ${i + 1}: feedback in 5 days.`).join('\n')});
  const pdf = Buffer.from(renderReceiptPdf({...model, content: long})).toString('latin1');
  assert.ok(Number(/\/Count (\d+)/.exec(pdf)[1]) >= 2);
  const t = drawnText(pdf);
  assert.ok(t.includes('Term 1: feedback') && t.includes('Term 60: feedback'));
});

test('an email-code identity check, when present, is printed with its signature', () => {
  const withId = {...model, context: {...model.context, identity: {method: 'email_otp', email: 'ada@example.test', verified_at: tick(-30), otp_id: 'o1'}, identity_signature: 'kid0.' + 'Z'.repeat(86)}};
  const t = drawnText(Buffer.from(renderReceiptPdf(withId)).toString('latin1')).replace(/\n/g, ' ');
  assert.ok(t.includes('Email code verified for ada@example.test at 2026-10-07 08:59:30 UTC'), 'identity line');
  assert.ok(t.replace(/ /g, '').includes('kid0.' + 'Z'.repeat(86)), 'identity signature');
  assert.ok(drawnText(text).includes('None: the name was typed by the reviewer'));
});

test('timestamps name their zone; invalid zones fall back to UTC', () => {
  assert.equal(stamp('2026-10-07T09:00:00.000Z', 'UTC'), '2026-10-07 09:00:00 UTC');
  assert.equal(stamp('2026-10-07T09:00:00.000Z', 'Not/AZone'), '2026-10-07 09:00:00 UTC');
  assert.match(stamp('2026-01-15T12:00:00.000Z', 'America/New_York'), /07:00:00 GMT-5, America\/New_York\)$/);
  assert.equal(validTimeZone('Asia/Kolkata'), true);
  assert.equal(validTimeZone('x'.repeat(65)), false);
  assert.equal(stamp(null, 'UTC'), 'not recorded');
});

test('text encoding escapes PDF syntax and never emits raw non-WinAnsi bytes', () => {
  assert.deepEqual(winAnsi('a(b)\\'), [97, 40, 98, 41, 92]);
  assert.deepEqual(winAnsi('₹5'), [82, 115, 46, 53]);
  assert.deepEqual(winAnsi('தமிழ்'), [63, 63, 63, 63, 63]);
  assert.ok(winAnsi('€£’').every(b => b < 256));
  assert.deepEqual(wrap('x'.repeat(30), 50, 10, 'mono'), ['xxxxxxxx', 'xxxxxxxx', 'xxxxxxxx', 'xxxxxx']);
});
