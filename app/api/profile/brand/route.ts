import {db, json, ownerAuth, safeOrigin, allowWrite, failure} from '@/lib/server';
import {brandSchema} from '@/lib/brand';
import {ImageError, parseLogo} from '@/lib/image';
// Branding (lib/brand.ts): accent colour, logo and reply-to address. Separate from the profile PUT
// because a logo is larger than the 24 KB JSON limit; this route accepts up to 240 KB.
const MAX = 240_000;
export async function PUT(request: Request) {
  try {
    if (!safeOrigin(request)) return json({error: 'Origin not allowed.'}, 403);
    const auth = await ownerAuth(request);
    if (!auth) return json({error: 'Sign in or provide a valid API token.'}, 401);
    if (!auth.scopes.includes('scopes:write')) return json({error: 'This credential cannot change settings.'}, 403);
    if (!await allowWrite('owner:' + auth.user)) return json({error: 'Write limit reached. Try again in a minute.'}, 429);
    if (Number(request.headers.get('content-length') || 0) > MAX) return json({error: 'Use a logo under 150 KB.'}, 413);
    const text = await request.text();
    if (text.length > MAX) return json({error: 'Use a logo under 150 KB.'}, 413);
    let raw;
    try { raw = JSON.parse(text); } catch { return json({error: 'Provide valid JSON.'}, 400); }
    const input = brandSchema.safeParse(raw);
    if (!input.success) return json({error: input.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ')}, 400);
    const b = input.data;
    let logo: string | null | undefined, hash: string | null | undefined;
    if (b.logo !== undefined) {
      if (b.logo === '') { logo = null; hash = null; }
      else {
        try { const parsed = parseLogo(b.logo); logo = b.logo.trim().replace(/\s+/g, ''); hash = parsed.hash; }
        catch (e) { if (e instanceof ImageError) return json({error: e.message, code: 'invalid_logo'}, 400); throw e; }
      }
    }
    const now = new Date().toISOString();
    const keepLogo = logo === undefined;
    const row = await db().prepare(`INSERT INTO business_profiles (owner,brand_color,reply_to,logo,logo_hash,updated) VALUES (?,?,?,?,?,?) ON CONFLICT (owner) DO UPDATE SET brand_color=excluded.brand_color,reply_to=excluded.reply_to${keepLogo ? '' : ',logo=excluded.logo,logo_hash=excluded.logo_hash'},updated=excluded.updated RETURNING brand_color,reply_to,logo,logo_hash`)
      .bind(auth.user, b.brand_color.toLowerCase() || null, b.reply_to || null, logo ?? null, hash ?? null, now).first<{brand_color: string | null; reply_to: string | null; logo: string | null; logo_hash: string | null}>();
    return json({brand: {brand_color: row?.brand_color ?? '', reply_to: row?.reply_to ?? '', logo: row?.logo ?? '', logo_url: row?.logo_hash ? `/api/brand/${row.logo_hash}` : null}});
  } catch (e) { return failure(e); }
}
