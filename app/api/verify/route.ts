import {json, allowRead, failure, ipKey} from '@/lib/server';
import {verifyAnchor} from '@/lib/receipt-server';
// Public receipt check behind the PDF's QR code: GET /api/verify?p=<project>&v=<version>&a=<fingerprint>.
export async function GET(request: Request) {
  try {
    if (!await allowRead('verify-ip:' + await ipKey(request), 60)) return json({error: 'Too many requests. Try again in a minute.'}, 429);
    const q = new URL(request.url).searchParams;
    const p = q.get('p') ?? '', v = Number(q.get('v')), a = (q.get('a') ?? '').toLowerCase();
    if (!/^[A-Za-z0-9_-]{1,80}$/.test(p) || !Number.isInteger(v) || v < 1 || v > 100000 || !/^[a-f0-9]{64}$/.test(a)) return json({error: 'This verification link is incomplete. Scan the QR code again or check the printed fingerprint.'}, 400);
    return json(await verifyAnchor(p, v, a));
  } catch (e) { return failure(e); }
}
