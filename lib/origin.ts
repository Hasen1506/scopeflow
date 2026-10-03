export function appOrigin(request: Request) {
  return new URL(process.env.APP_URL || request.url).origin;
}
export function safeOrigin(request: Request) {
  const origin = request.headers.get('origin');
  return !origin || origin === appOrigin(request);
}
export function safeReturnPath(value: unknown) {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//') || /[\\\r\n]/.test(value)) return '/';
  const url = new URL(value, 'https://scopeflow.local');
  if (url.origin !== 'https://scopeflow.local' || url.pathname.startsWith('/auth/') || url.pathname.startsWith('/api/auth/')) return '/';
  return url.pathname + url.search + url.hash;
}
