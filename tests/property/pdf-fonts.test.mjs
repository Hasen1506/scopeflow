// Embedded fonts and HarfBuzz shaping in PDFs (lib/pdf-fonts.ts, lib/pdf.ts): Indian scripts, Greek
// and Cyrillic are drawn with embedded Noto fonts instead of "?", text stays extractable, and plain
// WinAnsi documents are byte-for-byte the same with or without the shaper.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtempSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import '../support/ts-resolve.mjs';

const pdf = await import('../../lib/pdf.ts');
const {ensurePdfFonts, ttfMetrics} = await import('../../lib/pdf-fonts.ts');
const dir = mkdtempSync(join(tmpdir(), 'pdffonts-'));
const doc = lines => { const d = new pdf.PdfDocument(); lines.forEach((l, i) => d.text(48, 780 - i * 24, l, {size: 14})); return Buffer.from(d.toBytes()); };

test('WinAnsi-only documents are identical with and without the shaper', async () => {
  pdf.setPdfShaper(null);
  const lines = ['Scope of work', 'Total with GST Rs.1,180', 'Café · über — “quoted”'];
  const before = doc(lines);
  await ensurePdfFonts();
  assert.ok(doc(lines).equals(before), 'same bytes');
  // A character outside WinAnsi was "?" before; now it is a real glyph.
  pdf.setPdfShaper(null);
  assert.match(doc(['naïve']).toString('latin1'), /\(na\?ve\)/);
  await ensurePdfFonts().then(s => pdf.setPdfShaper(s));
  assert.doesNotMatch(doc(['naïve']).toString('latin1'), /\(na\?ve\)/);
});

test('Indian scripts, Greek and Cyrillic are embedded, shaped and extractable', async () => {
  const shaper = await ensurePdfFonts();
  assert.ok(shaper && shaper.fonts.length >= 9);
  const lines = ['Client: स्टूडियो क्षत्रिय', 'தமிழ் ஸ்டுடியோ', 'ಕನ್ನಡ తెలుగు മലയാളം বাংলা ગુજરાતી ਪੰਜਾਬੀ', 'Ελληνικά Русский Łódź'];
  const bytes = doc(lines);
  const text = bytes.toString('latin1');
  assert.match(text, /\/Subtype \/Type0/); assert.match(text, /\/CIDFontType2/); assert.match(text, /\/ToUnicode/); assert.match(text, /\/FontFile2/);
  assert.doesNotMatch(text, /\(Client: \?/, 'no question marks for Devanagari');
  writeFileSync(join(dir, 'f.pdf'), bytes);
  const extracted = execFileSync('pdftotext', [join(dir, 'f.pdf'), '-'], {stdio: 'pipe'}).toString().replace(/\s+/g, '');
  for (const word of ['Русский', 'Ελληνικά', 'Łódź']) assert.ok(extracted.includes(word), word);
  assert.ok(extracted.includes('क्षत्रि') || extracted.includes('क्ष'), 'Devanagari conjuncts extract as text');
  // Conjunct shaping: क्ष is one ligature glyph, not three, in Noto Sans Devanagari.
  const dev = shaper.fontFor('क'.codePointAt(0));
  assert.ok(shaper.shape('क्ष', dev).length < 3);
  // Widths follow the shaped advances, so wrapping works for these scripts too.
  assert.ok(pdf.textWidth('स्टूडियो', 10) > 10);
  execFileSync('pdftoppm', ['-r', '20', '-f', '1', '-l', '1', '-png', join(dir, 'f.pdf'), join(dir, 'p')], {stdio: 'pipe'});
});

test('TrueType metrics come from the font tables; non-TrueType files are rejected', async () => {
  const {readFileSync} = await import('node:fs');
  const m = ttfMetrics(new Uint8Array(readFileSync(join(process.cwd(), 'assets/fonts/NotoSans-Regular.ttf'))));
  assert.equal(m.upem, 1000); assert.ok(m.ascent > 700 && m.descent < 0 && m.capHeight > 500);
  assert.throws(() => ttfMetrics(new Uint8Array(64)), /TrueType/);
});
