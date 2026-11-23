import 'server-only';
import type { DecodedIdToken } from 'firebase-admin/auth';
import { adminAuth } from './firebase-admin';
import { getOrCreateUser } from '../db/users';

export interface VerifiedFirebaseUser {
  uid: string;
  email: string;
  displayName: string;
  token: DecodedIdToken;
}

export function extractBearerToken(request: Request): string | null {
  const header = request.headers.get('authorization');
  if (!header) return null;
  const match = /^bearer[ \t]+([A-Za-z0-9._~+/=-]+)\s*$/i.exec(header);
  return match ? match[1] : null;
}

export async function verifyFirebaseRequest(
  request: Request,
  { syncUser = true }: { syncUser?: boolean } = {},
): Promise<VerifiedFirebaseUser | null> {
  const token = extractBearerToken(request);
  if (!token) return null;
  try {
    const decoded = await adminAuth.verifyIdToken(token);
    const email = decoded.email || `${decoded.uid}@termslock.local`;
    const displayName = (decoded.name as string | undefined) || email.split('@')[0] || 'TermsLock Member';
    if (syncUser) {
      await getOrCreateUser(decoded.uid, email, displayName);
    }
    return {
      uid: decoded.uid,
      email,
      displayName,
      token: decoded,
    };
  } catch (error) {
    console.error('Firebase token verification failed:', error);
    return null;
  }
}
