import {publicSigningKey} from '@/lib/signing';
import {json} from '@/lib/server';
export const dynamic = 'force-dynamic';
// SF-04: public key for checking decision receipts and ledger signatures (Ed25519, JWK).
export function GET() { const key = publicSigningKey(); return key ? json({keys: [key]}, 200, {'Cache-Control': 'public, max-age=3600'}) : json({keys: [], note: 'Signing is not configured.'}); }
