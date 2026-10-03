import 'server-only';
import { createNeonAuth } from '@neondatabase/auth/next/server';

let auth: ReturnType<typeof createNeonAuth> | undefined;
export function authConfigured() {
  return Boolean(process.env.NEON_AUTH_BASE_URL && process.env.NEON_AUTH_COOKIE_SECRET);
}
export function getAuth() {
  if (!auth) {
    const baseUrl = process.env.NEON_AUTH_BASE_URL;
    const secret = process.env.NEON_AUTH_COOKIE_SECRET;
    if (!baseUrl || !secret) throw new Error('Neon Auth is not configured');
    const destination = new URL(baseUrl);
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(destination.hostname);
    if (process.env.RENDER && local) throw new Error('Use a real Neon Auth URL on Render');
    if (destination.protocol !== 'https:' && !local) throw new Error('Neon Auth requires HTTPS');
    auth = createNeonAuth({ baseUrl: baseUrl.replace(/\/+$/, ''), cookies: { secret, sessionDataTtl: 60, sameSite: 'lax' } });
  }
  return auth;
}

export async function getUser() {
  if (!authConfigured()) return null;
  // Verify with Neon on every privileged request, including revoked sessions.
  // Never accept the old hosting platform's identity headers as authentication.
  const { data, error } = await getAuth().getSession({ query: { disableCookieCache: 'true' } });
  if (error || !data?.user) return null;
  return { userId: data.user.id, email: data.user.email, displayName: data.user.name || data.user.email };
}
