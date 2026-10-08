// Set when /api/me reports a signed-in session, so returning owners get the compact workspace
// heading before first paint instead of the signed-out hero (avoids a layout shift).
export const SESSION_HINT_KEY = 'scopeflow:signed-in';
export function rememberSession(signedIn: boolean) {
  if (typeof document === 'undefined') return;
  if (signedIn) document.documentElement.dataset.auth = 'in'; else delete document.documentElement.dataset.auth;
  try { if (signedIn) localStorage.setItem(SESSION_HINT_KEY, '1'); else localStorage.removeItem(SESSION_HINT_KEY); } catch { /* storage unavailable */ }
}
