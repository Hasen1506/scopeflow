import {db} from './server';
import {parseLogo} from './image';
import type {Brand} from './brand';

type Row = {business_name: string | null; brand_color: string | null; logo: string | null; logo_hash: string | null; reply_to: string | null};
/** The owner's brand, or null when they set none. A stored logo that no longer parses is ignored. */
export async function loadBrand(owner: string): Promise<(Brand & {logoHash: string | null}) | null> {
  const row = await db().prepare('SELECT business_name,brand_color,logo,logo_hash,reply_to FROM business_profiles WHERE owner=?').bind(owner).first<Row>();
  if (!row || (!row.brand_color && !row.logo && !row.reply_to)) return null;
  let logo = null;
  try { logo = row.logo ? parseLogo(row.logo) : null; } catch { logo = null; }
  return {name: row.business_name ?? '', color: row.brand_color, logo, replyTo: row.reply_to, logoHash: logo ? row.logo_hash : null};
}
export async function brandForProject(projectId: string) {
  const p = await db().prepare('SELECT owner FROM projects WHERE id=?').bind(projectId).first<{owner: string}>();
  return p ? loadBrand(p.owner) : null;
}
