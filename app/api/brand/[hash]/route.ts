import {db} from '@/lib/server';
import {parseLogo} from '@/lib/image';
type Ctx = {params: Promise<{hash: string}>};
// An owner's logo by its content hash, for email clients that do not show data: images. The hash
// is derived from the image bytes, so the URL reveals nothing about the owner and never changes for
// the same image (cacheable for a year).
export async function GET(_request: Request, ctx: Ctx) {
  const {hash} = await ctx.params;
  const missing = () => new Response('Not found', {status: 404, headers: {'Cache-Control': 'no-store'}});
  if (!/^[a-f0-9]{32}$/.test(hash)) return missing();
  try {
    const row = await db().prepare('SELECT logo FROM business_profiles WHERE logo_hash=? LIMIT 1').bind(hash).first<{logo: string | null}>();
    if (!row?.logo) return missing();
    const logo = parseLogo(row.logo);
    return new Response(Buffer.from(logo.bytes), {headers: {'Content-Type': logo.mime, 'Cache-Control': 'public, max-age=31536000, immutable', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'"}});
  } catch { return missing(); }
}
