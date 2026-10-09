import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {setPdfShaper, type EmbeddedFont, type ShapedGlyph, type Shaper} from './pdf';

// Loads the bundled Noto fonts (assets/fonts, SIL Open Font License) and HarfBuzz, and registers a
// shaper with the PDF writer so names and text in Indian scripts, Greek, Cyrillic and extended
// Latin print correctly in receipts, statements and invoices. SCOPEFLOW_PDF_EXTRA_FONTS adds more
// TrueType (.ttf) files, comma separated, for other scripts (for example a CJK font). Loaded once;
// if anything fails, PDFs keep working with the built-in fonts (unsupported characters print "?").

const BUNDLED = ['NotoSans-Regular.ttf', 'NotoSansDevanagari-Regular.ttf', 'NotoSansTamil-Regular.ttf', 'NotoSansBengali-Regular.ttf', 'NotoSansTelugu-Regular.ttf', 'NotoSansKannada-Regular.ttf', 'NotoSansMalayalam-Regular.ttf', 'NotoSansGujarati-Regular.ttf', 'NotoSansGurmukhi-Regular.ttf'];

/** Reads the metrics a PDF font descriptor needs from the TrueType tables (scaled to 1000 units). */
export function ttfMetrics(data: Uint8Array) {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const tables = new Map<string, number>();
  for (let i = 0, n = view.getUint16(4); i < n; i++) {
    const at = 12 + i * 16;
    tables.set(String.fromCharCode(...data.subarray(at, at + 4)), view.getUint32(at + 8));
  }
  const head = tables.get('head'), hhea = tables.get('hhea'), os2 = tables.get('OS/2');
  if (head === undefined || hhea === undefined || !tables.has('glyf')) throw new Error('Not a TrueType (glyf) font.');
  const upem = view.getUint16(head + 18), k = 1000 / upem;
  const bbox: [number, number, number, number] = [view.getInt16(head + 36) * k, view.getInt16(head + 38) * k, view.getInt16(head + 40) * k, view.getInt16(head + 42) * k];
  const ascent = view.getInt16(hhea + 4) * k, descent = view.getInt16(hhea + 6) * k;
  const capHeight = os2 !== undefined && view.getUint16(os2) >= 2 ? view.getInt16(os2 + 88) * k : ascent * 0.7;
  return {upem, bbox, ascent, descent, capHeight};
}

let loading: Promise<Shaper | null> | null = null;
/** Loads fonts and HarfBuzz once and registers the shaper. Safe to call before every render. */
export function ensurePdfFonts(env: Record<string, string | undefined> = process.env): Promise<Shaper | null> {
  loading ??= load(env).catch(e => { console.warn('Scopeflow PDF fonts unavailable:', (e as Error).message); return null; });
  return loading;
}

async function load(env: Record<string, string | undefined>): Promise<Shaper | null> {
  const hb = await import('harfbuzzjs');
  const dir = join(process.cwd(), 'assets', 'fonts');
  const files = [...BUNDLED.map(f => join(dir, f)), ...(env.SCOPEFLOW_PDF_EXTRA_FONTS ?? '').split(',').map(s => s.trim()).filter(Boolean)];
  const loaded: {meta: EmbeddedFont; font: InstanceType<typeof hb.Font>; unicodes: Set<number>; scale: number}[] = [];
  for (const path of files) {
    try {
      const data = new Uint8Array(readFileSync(path));
      const m = ttfMetrics(data);
      const face = new hb.Face(new hb.Blob(data), 0);
      const font = new hb.Font(face);
      const name = path.split('/').pop()!.replace(/\.ttf$/i, '');
      loaded.push({meta: {name, data, ascent: m.ascent, descent: m.descent, capHeight: m.capHeight, bbox: m.bbox}, font, unicodes: new Set(face.collectUnicodes()), scale: 1000 / face.upem});
    } catch (e) { console.warn(`Scopeflow PDF font skipped (${path}):`, (e as Error).message); }
  }
  if (!loaded.length) return null;
  const cache = new Map<string, ShapedGlyph[]>();
  const shaper: Shaper = {
    fonts: loaded.map(l => l.meta),
    covers: (i, cp) => loaded[i].unicodes.has(cp),
    fontFor: cp => loaded.findIndex(l => l.unicodes.has(cp)),
    shape(text, i) {
      const key = i + '\u0000' + text;
      const hit = cache.get(key);
      if (hit) return hit;
      const l = loaded[i];
      const buffer = new hb.Buffer();
      buffer.addText(text);
      buffer.guessSegmentProperties();
      hb.shape(l.font, buffer);
      const glyphs = buffer.getGlyphInfosAndPositions();
      // Each glyph stands for its cluster's text (the first glyph of a cluster carries it, for copy and search).
      const starts = [...new Set(glyphs.map(g => g.cluster))].sort((a, b) => a - b);
      const seen = new Set<number>();
      const out = glyphs.map(g => {
        const end = starts.find(s => s > g.cluster) ?? text.length;
        const first = !seen.has(g.cluster); seen.add(g.cluster);
        return {gid: g.codepoint, x: (g.xOffset ?? 0) * l.scale, y: (g.yOffset ?? 0) * l.scale, adv: (g.xAdvance ?? 0) * l.scale, text: first ? text.slice(g.cluster, end) : ''};
      });
      if (cache.size > 5000) cache.clear();
      cache.set(key, out);
      return out;
    },
  };
  setPdfShaper(shaper);
  return shaper;
}
