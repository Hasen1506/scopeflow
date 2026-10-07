// A small, dependency-free PDF 1.4 writer for server-generated receipts.
//
// Deterministic by construction: the same input always produces the same bytes (no
// creation date, no random ids, uncompressed content streams), so receipts can be
// golden-tested byte for byte and inspected with any text tool. Text uses the standard
// Type 1 fonts (Helvetica, Helvetica-Bold, Courier) with WinAnsiEncoding; characters
// outside WinAnsi are transliterated where a common equivalent exists, else shown as "?".

export type Font = 'regular' | 'bold' | 'mono';
const FONT_RESOURCE: Record<Font, string> = {regular: 'F1', bold: 'F2', mono: 'F3'};
const FONT_NAME: Record<Font, string> = {regular: 'Helvetica', bold: 'Helvetica-Bold', mono: 'Courier'};

// Helvetica advance widths (1/1000 em) for ASCII 32..126, from the standard AFM.
const HELVETICA = [278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584];

// Unicode → WinAnsi (cp1252) bytes for the characters that commonly appear in scopes.
const WIN_ANSI: Record<string, number> = {'€': 0x80, '‚': 0x82, '„': 0x84, '…': 0x85, '‘': 0x91, '’': 0x92, '“': 0x93, '”': 0x94, '•': 0x95, '–': 0x96, '—': 0x97, '™': 0x99, '£': 0xa3, '¥': 0xa5, '©': 0xa9, '®': 0xae, '°': 0xb0, '·': 0xb7, '×': 0xd7, 'é': 0xe9, 'è': 0xe8, 'ê': 0xea, 'á': 0xe1, 'à': 0xe0, 'â': 0xe2, 'ä': 0xe4, 'ç': 0xe7, 'í': 0xed, 'ñ': 0xf1, 'ó': 0xf3, 'ö': 0xf6, 'ú': 0xfa, 'ü': 0xfc, 'ß': 0xdf, 'É': 0xc9, 'Ö': 0xd6, 'Ü': 0xdc, 'Ä': 0xc4, '\u00a0': 0x20};
const TRANSLITERATE: Record<string, string> = {'₹': 'Rs.', '→': '->', '←': '<-', '≈': '~', '✓': 'v', '−': '-', '\u202f': ' ', '\u2009': ' ', '\u200b': ''};

/** Encode text as WinAnsi bytes (one byte per glyph). */
export function winAnsi(text: string): number[] {
  const out: number[] = [];
  for (const ch of text.normalize('NFC')) {
    const code = ch.codePointAt(0)!;
    if (code >= 0x20 && code <= 0x7e) out.push(code);
    else if (WIN_ANSI[ch] !== undefined) out.push(WIN_ANSI[ch]);
    else if (TRANSLITERATE[ch] !== undefined) for (const c of TRANSLITERATE[ch]) out.push(c.charCodeAt(0));
    else if (ch === '\t') out.push(0x20);
    else if (code >= 0x20) out.push(0x3f); // "?"
  }
  return out;
}

/** Width of `text` in points at `size`. Bold is approximated conservatively for wrapping. */
export function textWidth(text: string, size: number, font: Font = 'regular') {
  if (font === 'mono') return winAnsi(text).length * 0.6 * size;
  const units = winAnsi(text).reduce((sum, b) => sum + (b >= 32 && b <= 126 ? HELVETICA[b - 32] : 556), 0);
  return (units / 1000) * size * (font === 'bold' ? 1.08 : 1);
}

/** Greedy word wrap to `width` points; very long tokens (hashes, URLs) are hard-split. */
export function wrap(text: string, width: number, size: number, font: Font = 'regular'): string[] {
  const lines: string[] = [];
  for (const paragraph of text.replace(/\r\n?/g, '\n').split('\n')) {
    let line = '';
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      let w = word;
      while (textWidth(w, size, font) > width) {
        let n = w.length;
        while (n > 1 && textWidth(w.slice(0, n), size, font) > width) n--;
        if (line) { lines.push(line); line = ''; }
        lines.push(w.slice(0, n));
        w = w.slice(n);
      }
      const next = line ? line + ' ' + w : w;
      if (textWidth(next, size, font) > width && line) { lines.push(line); line = w; } else line = next;
    }
    lines.push(line);
  }
  return lines;
}

function pdfString(text: string) {
  return '(' + winAnsi(text).map(b => (b === 0x28 || b === 0x29 || b === 0x5c ? '\\' + String.fromCharCode(b) : b > 0x7e ? '\\' + b.toString(8).padStart(3, '0') : String.fromCharCode(b))).join('') + ')';
}
const n = (v: number) => (Math.round(v * 100) / 100).toString();

/** Page-by-page drawing surface in PDF points (origin bottom-left, A4 by default). */
export class PdfDocument {
  readonly width: number;
  readonly height: number;
  private pages: string[][] = [];
  private info: Record<string, string>;
  constructor({width = 595.28, height = 841.89, info = {}}: {width?: number; height?: number; info?: Record<string, string>} = {}) {
    this.width = width; this.height = height; this.info = info;
  }
  addPage() { this.pages.push([]); return this.pages.length - 1; }
  private get ops() { if (!this.pages.length) this.addPage(); return this.pages[this.pages.length - 1]; }
  text(x: number, y: number, text: string, {size = 10, font = 'regular' as Font, gray = 0} = {}) {
    this.ops.push(`BT /${FONT_RESOURCE[font]} ${n(size)} Tf ${n(gray)} g ${n(x)} ${n(y)} Td ${pdfString(text)} Tj ET`);
  }
  line(x1: number, y1: number, x2: number, y2: number, {width = 0.5, gray = 0.75} = {}) {
    this.ops.push(`${n(gray)} G ${n(width)} w ${n(x1)} ${n(y1)} m ${n(x2)} ${n(y2)} l S`);
  }
  rect(x: number, y: number, w: number, h: number, {gray = 0} = {}) {
    this.ops.push(`${n(gray)} g ${n(x)} ${n(y)} ${n(w)} ${n(h)} re f`);
  }
  /** Raw marker comment (e.g. to delimit the QR code for tests and tooling). */
  comment(text: string) { this.ops.push('% ' + text.replace(/[\r\n]/g, ' ')); }

  toBytes(): Uint8Array {
    if (!this.pages.length) this.addPage();
    const objects: string[] = [];
    const add = (body: string) => { objects.push(body); return objects.length; };
    const catalog = add(''), pagesId = add('');
    const fonts = (['regular', 'bold', 'mono'] as Font[]).map(f => add(`<< /Type /Font /Subtype /Type1 /BaseFont /${FONT_NAME[f]} /Encoding /WinAnsiEncoding >>`));
    const resources = `<< /Font << /F1 ${fonts[0]} 0 R /F2 ${fonts[1]} 0 R /F3 ${fonts[2]} 0 R >> >>`;
    const kids: number[] = [];
    for (const ops of this.pages) {
      const stream = ops.join('\n');
      const content = add(`<< /Length ${Buffer.byteLength(stream, 'latin1')} >>\nstream\n${stream}\nendstream`);
      kids.push(add(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${n(this.width)} ${n(this.height)}] /Resources ${resources} /Contents ${content} 0 R >>`));
    }
    objects[catalog - 1] = `<< /Type /Catalog /Pages ${pagesId} 0 R >>`;
    objects[pagesId - 1] = `<< /Type /Pages /Kids [${kids.map(k => k + ' 0 R').join(' ')}] /Count ${kids.length} >>`;
    const infoEntries = Object.entries(this.info).map(([k, v]) => `/${k.replace(/[^A-Za-z]/g, '')} ${pdfString(v)}`).join(' ');
    const info = add(`<< ${infoEntries} >>`);
    let out = '%PDF-1.4\n%\xe2\xe3\xcf\xd3\n';
    const offsets: number[] = [];
    objects.forEach((body, i) => { offsets.push(Buffer.byteLength(out, 'latin1')); out += `${i + 1} 0 obj\n${body}\nendobj\n`; });
    const xref = Buffer.byteLength(out, 'latin1');
    out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n` + offsets.map(o => String(o).padStart(10, '0') + ' 00000 n \n').join('');
    out += `trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R /Info ${info} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
    return new Uint8Array(Buffer.from(out, 'latin1'));
  }
}
