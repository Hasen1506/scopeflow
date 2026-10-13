import {publishedKeys, signingStatus} from '@/lib/signing';
import {json} from '@/lib/server';
export const dynamic = 'force-dynamic';
// SF-04: public keys for checking decision receipts and ledger signatures (Ed25519, JWK). The
// current key comes first; retired dedicated keys and allow-listed legacy keys (C6) follow with a
// `status`, so an older receipt still checks offline. `signing` is the server's status (C1).
export function GET() {
  const keys = publishedKeys();
  const signing = signingStatus();
  return keys.length ? json({keys, signing}, 200, {'Cache-Control': 'public, max-age=3600'}) : json({keys: [], signing, note: 'Signing is not configured.'});
}
