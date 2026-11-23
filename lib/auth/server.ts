import 'server-only';
import { createNeonAuth } from '@neondatabase/auth/next/server';
import { headers } from 'next/headers';
import { requestMemo, type SessionMode } from './memo';

let auth: ReturnType<typeof createNeonAuth> | undefined;
export function authConfigured() {
  return Boolean(process.env.NEON_AUTH_BASE_URL && process.env.NEON_AUTH_COOKIE_SECRET);
}
// M27: the signed session-data cookie may answer reads for up to this many seconds.
export const SESSION_CACHE_SECONDS = 60;
export function getAuth() {
  if (!auth) {
    const baseUrl = process.env.NEON_AUTH_BASE_URL;
    const secret = process.env.NEON_AUTH_COOKIE_SECRET;
    if (!baseUrl || !secret) throw new Error('Neon Auth is not configured');
    const destination = new URL(baseUrl);
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(destination.hostname);
    if (process.env.RENDER && local) throw new Error('Use a real Neon Auth URL on Render');
    if (destination.protocol !== 'https:' && !local) throw new Error('Neon Auth requires HTTPS');
    auth = createNeonAuth({ baseUrl: baseUrl.replace(/\/+$/, ''), cookies: { secret, sessionDataTtl: SESSION_CACHE_SECONDS, sameSite: 'lax' } });
  }
  return auth;
}

export type SessionUser = { userId: string; email: string; displayName: string };
const memo = requestMemo<object, SessionUser | null>();
/** Counts Neon lookups (not memo hits); read by tests through the module only. */
export const sessionLookups = { fresh: 0, cached: 0 };

const JWT_RE = /^bearer[ \t]+([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)\s*$/i;

async function lookupFirebaseBearer(): Promise<SessionUser | null> {
  try {
    const h = await headers();
    const authHeader = h.get('authorization');
    if (!authHeader) return null;
    const match = JWT_RE.exec(authHeader);
    if (!match || match[1].startsWith('sfo_')) return null;
    const { adminAuth } = await import('@/src/lib/firebase-admin');
    const decoded = await adminAuth.verifyIdToken(match[1]);
    const email = decoded.email || `${decoded.uid}@termslock.local`;
    const displayName = (decoded.name as string | undefined) || email.split('@')[0] || 'TermsLock Member';
    return { userId: decoded.uid, email, displayName };
  } catch {
    return null;
  }
}

async function lookup(mode: SessionMode): Promise<SessionUser | null> {
  if (authConfigured()) {
    sessionLookups[mode]++;
    // Never accept the old hosting platform's identity headers as authentication.
    const { data, error } = await getAuth().getSession(mode === 'fresh' ? { query: { disableCookieCache: 'true' } } : undefined);
    if (!error && data?.user) {
      return { userId: data.user.id, email: data.user.email, displayName: data.user.name || data.user.email };
    }
  }
  return lookupFirebaseBearer();
}

/** The per-request key: Next's headers object for the current request, or null outside one. */
async function requestKey(): Promise<object | null> {
  try { return (await headers()) as unknown as object; } catch { return null; }
}

/**
 * The signed-in user. `fresh` (the default) verifies the session with Neon, including revoked
 * sessions, and is what every state-changing path uses. `{fresh: false}` lets a read use the signed
 * session cookie cache. Either way Neon is asked at most once per request (M27).
 * Falls back to verifying a Firebase Auth Bearer ID token when signed in with Firebase Auth.
 */
export async function getUser({ fresh = true }: { fresh?: boolean } = {}) {
  const mode: SessionMode = fresh ? 'fresh' : 'cached';
  return memo(await requestKey(), mode, lookup);
}
