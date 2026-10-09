import {deflateSync, inflateSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import type {PdfImageData} from './pdf';

// Owner logos: a small PNG or JPEG uploaded as a data: URL, validated here and converted to what
// the PDF writer embeds (JPEG as-is with DCTDecode; PNG decoded to raw samples, re-compressed with
// FlateDecode, with any transparency as a soft mask). Pure.

export const LOGO_MAX_BYTES = 150 * 1024;
export const LOGO_MAX_SIDE = 2000;
export type PdfImage = PdfImageData;
export type Logo = {mime: 'image/png' | 'image/jpeg'; bytes: Uint8Array; width: number; height: number; hash: string};
export class ImageError extends Error {}

/** Decodes and checks a data: URL logo. Throws ImageError with a message for the owner. */
export function parseLogo(dataUrl: string): Logo {
  const m = /^data:(image\/(?:png|jpeg));base64,([A-Za-z0-9+/=\s]+)$/.exec(dataUrl.trim());
  if (!m) throw new ImageError('Upload the logo as a PNG or JPEG image.');
  const bytes = new Uint8Array(Buffer.from(m[2].replace(/\s+/g, ''), 'base64'));
  if (!bytes.length) throw new ImageError('The logo file is empty.');
  if (bytes.length > LOGO_MAX_BYTES) throw new ImageError(`The logo is ${Math.ceil(bytes.length / 1024)} KB; use an image under ${LOGO_MAX_BYTES / 1024} KB.`);
  const mime = m[1] as Logo['mime'];
  const {width, height} = mime === 'image/png' ? pngHeader(bytes) : jpegHeader(bytes);
  if (width > LOGO_MAX_SIDE || height > LOGO_MAX_SIDE) throw new ImageError(`The logo is ${width}×${height} pixels; use one at most ${LOGO_MAX_SIDE} pixels on each side.`);
  pdfImage({mime, bytes, width, height, hash: ''}); // decodes fully, so a broken file is refused at upload
  return {mime, bytes, width, height, hash: createHash('sha256').update(bytes).digest('hex').slice(0, 32)};
}
export const logoDataUrl = (logo: Pick<Logo, 'mime' | 'bytes'>) => `data:${logo.mime};base64,${Buffer.from(logo.bytes).toString('base64')}`;

const u32 = (b: Uint8Array, i: number) => ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0;
const PNG_SIG = [137, 80, 78, 71, 13, 10, 26, 10];
type Chunk = {type: string; data: Uint8Array};
function pngChunks(b: Uint8Array): Chunk[] {
  if (b.length < 33 || PNG_SIG.some((v, i) => b[i] !== v)) throw new ImageError('The file is not a valid PNG image.');
  const chunks: Chunk[] = [];
  for (let i = 8; i + 8 <= b.length;) {
    const len = u32(b, i), type = String.fromCharCode(...b.subarray(i + 4, i + 8));
    if (i + 12 + len > b.length) throw new ImageError('The PNG image is truncated.');
    chunks.push({type, data: b.subarray(i + 8, i + 8 + len)});
    i += 12 + len;
    if (type === 'IEND') break;
  }
  return chunks;
}
function pngHeader(b: Uint8Array) {
  const ihdr = pngChunks(b)[0];
  if (ihdr?.type !== 'IHDR') throw new ImageError('The file is not a valid PNG image.');
  return {width: u32(ihdr.data, 0), height: u32(ihdr.data, 4)};
}
function jpegHeader(b: Uint8Array) {
  if (b[0] !== 0xff || b[1] !== 0xd8) throw new ImageError('The file is not a valid JPEG image.');
  for (let i = 2; i + 9 < b.length;) {
    if (b[i] !== 0xff) { i++; continue; }
    const marker = b[i + 1];
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue; }
    const len = (b[i + 2] << 8) | b[i + 3];
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
      const components = b[i + 9];
      if (components !== 1 && components !== 3) throw new ImageError('Save the logo as an RGB or greyscale JPEG (CMYK is not supported).');
      return {width: (b[i + 7] << 8) | b[i + 8], height: (b[i + 5] << 8) | b[i + 6], components};
    }
    i += 2 + len;
  }
  throw new ImageError('The JPEG image has no size information.');
}

function paeth(a: number, b: number, c: number) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); return pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
/** PNG (8 or 16 bit grey/RGB with or without alpha, or palette at 1–8 bits, not interlaced) to raw 8-bit samples. */
export function decodePng(b: Uint8Array): {width: number; height: number; colors: 1 | 3; pixels: Uint8Array; alpha: Uint8Array | null} {
  const chunks = pngChunks(b), h = chunks[0];
  if (h?.type !== 'IHDR') throw new ImageError('The file is not a valid PNG image.');
  const width = u32(h.data, 0), height = u32(h.data, 4), depth = h.data[8], type = h.data[9], interlace = h.data[12];
  if (interlace) throw new ImageError('Save the logo as a non-interlaced PNG.');
  const channels = ({0: 1, 2: 3, 3: 1, 4: 2, 6: 4} as Record<number, number>)[type];
  const okDepth = type === 3 ? [1, 2, 4, 8].includes(depth) : [8, 16].includes(depth);
  if (!channels || !okDepth || !width || !height) throw new ImageError('This PNG format is not supported; save the logo as a standard 8-bit PNG.');
  let raw: Buffer;
  try { raw = inflateSync(Buffer.concat(chunks.filter(c => c.type === 'IDAT').map(c => Buffer.from(c.data)))); } catch { throw new ImageError('The PNG image data is damaged.'); }
  const bitsPerPixel = channels * depth, stride = Math.ceil(width * bitsPerPixel / 8), bpp = Math.max(1, bitsPerPixel >> 3);
  if (raw.length < height * (stride + 1)) throw new ImageError('The PNG image data is truncated.');
  const out = new Uint8Array(height * stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)], line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)), row = y * stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? out[row + x - bpp] : 0, up = y ? out[row - stride + x] : 0, c = y && x >= bpp ? out[row - stride + x - bpp] : 0;
      const v = line[x];
      out[row + x] = filter === 0 ? v : filter === 1 ? v + a : filter === 2 ? v + up : filter === 3 ? v + ((a + up) >> 1) : filter === 4 ? v + paeth(a, up, c) : (() => { throw new ImageError('The PNG image data is damaged.'); })();
    }
  }
  const pixelsCount = width * height;
  if (type === 3) {
    const plte = chunks.find(c => c.type === 'PLTE')?.data, trns = chunks.find(c => c.type === 'tRNS')?.data;
    if (!plte) throw new ImageError('The PNG palette is missing.');
    const pixels = new Uint8Array(pixelsCount * 3), alpha = trns ? new Uint8Array(pixelsCount) : null;
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const bit = x * depth, byte = out[y * stride + (bit >> 3)], idx = (byte >> (8 - depth - (bit & 7))) & ((1 << depth) - 1), p = y * width + x;
      pixels[p * 3] = plte[idx * 3] ?? 0; pixels[p * 3 + 1] = plte[idx * 3 + 1] ?? 0; pixels[p * 3 + 2] = plte[idx * 3 + 2] ?? 0;
      if (alpha) alpha[p] = idx < trns!.length ? trns![idx] : 255;
    }
    return {width, height, colors: 3, pixels, alpha};
  }
  const step = depth / 8, colors = (type === 0 || type === 4 ? 1 : 3) as 1 | 3, hasAlpha = type === 4 || type === 6;
  const pixels = new Uint8Array(pixelsCount * colors), alpha = hasAlpha ? new Uint8Array(pixelsCount) : null;
  for (let p = 0; p < pixelsCount; p++) {
    const y = Math.floor(p / width), base = y * stride + (p % width) * channels * step;
    for (let c = 0; c < colors; c++) pixels[p * colors + c] = out[base + c * step];
    if (alpha) alpha[p] = out[base + colors * step];
  }
  return {width, height, colors, pixels, alpha: alpha && alpha.every(v => v === 255) ? null : alpha};
}

/** The logo as a PDF image XObject payload. */
export function pdfImage(logo: Logo): PdfImage {
  if (logo.mime === 'image/jpeg') { const h = jpegHeader(logo.bytes); return {width: h.width, height: h.height, filter: 'DCTDecode', colors: h.components as 1 | 3, data: logo.bytes, alpha: null}; }
  const d = decodePng(logo.bytes);
  return {width: d.width, height: d.height, filter: 'FlateDecode', colors: d.colors, data: new Uint8Array(deflateSync(d.pixels)), alpha: d.alpha ? new Uint8Array(deflateSync(d.alpha)) : null};
}

/** #rrggbb to PDF rgb components 0–1, or null. */
export function hexRgb(color: string | null | undefined): [number, number, number] | null {
  const m = /^#([0-9a-f]{6})$/i.exec(color ?? '');
  if (!m) return null;
  const v = parseInt(m[1], 16);
  return [(v >> 16 & 255) / 255, (v >> 8 & 255) / 255, (v & 255) / 255];
}
/** WCAG contrast ratio of a colour against white. */
export function contrastOnWhite(color: string) {
  const rgb = hexRgb(color);
  if (!rgb) return 1;
  const [r, g, b] = rgb.map(c => c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 1.05 / (0.2126 * r + 0.7152 * g + 0.0722 * b + 0.05);
}
