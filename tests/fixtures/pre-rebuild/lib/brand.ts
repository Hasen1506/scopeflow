import {z} from 'zod';
import type {PdfDocument} from './pdf';
import {contrastOnWhite, hexRgb, pdfImage, type Logo, type PdfImage} from './image';

// Owner branding: an accent colour, a logo and a reply-to address, applied to the client review
// page, the PDFs (receipt, invoice, statement) and client emails. The business name comes from the
// business profile. Everything is optional; without it the documents look as before.

export const brandSchema = z.object({
  brand_color: z.union([z.literal(''), z.string().trim().regex(/^#[0-9a-fA-F]{6}$/, 'Use a colour such as #1f6feb')]),
  reply_to: z.union([z.literal(''), z.string().trim().toLowerCase().max(254).email('Enter a valid reply-to email address')]),
  /** A data: URL to replace the logo, '' to remove it; leave out to keep the current one. */
  logo: z.string().max(220_000).optional(),
}).strict();

export type Brand = {name: string; color: string | null; logo: Logo | null; replyTo: string | null};
export type PdfBrand = {name: string; rgb: [number, number, number] | null; image: PdfImage | null};
export function pdfBrand(b: Brand | null): PdfBrand | null {
  if (!b || (!b.color && !b.logo)) return null;
  let image: PdfImage | null = null;
  try { image = b.logo ? pdfImage(b.logo) : null; } catch { image = null; }
  return {name: b.name, rgb: hexRgb(b.color), image};
}

/** A colour safe for text on white: the brand colour when it has 4.5:1 contrast, else null. */
export const textSafe = (color: string | null) => color && contrastOnWhite(color) >= 4.5 ? color : null;

/**
 * Draws the brand at the top of the current page: a thin accent bar across the top edge and the
 * logo in the top-right (or top-left) corner (at most 120×40 pt, aspect kept). Returns the height used below
 * `top` so the caller can start its content under the logo.
 */
export function drawPdfBrand(doc: PdfDocument, brand: PdfBrand | null, {margin, top, align = 'right'}: {margin: number; top: number; align?: 'left' | 'right'}): number {
  if (!brand) return 0;
  if (brand.rgb) doc.rect(0, doc.height - 6, doc.width, 6, {rgb: brand.rgb});
  if (!brand.image) return 0;
  const scale = Math.min(120 / brand.image.width, 40 / brand.image.height);
  const w = brand.image.width * scale, h = brand.image.height * scale;
  doc.image(align === 'left' ? margin : doc.width - margin - w, top - h, w, h, brand.image);
  return h + 8;
}
