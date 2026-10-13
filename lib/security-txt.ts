// Gap audit H7/L8: /.well-known/security.txt (RFC 9116). Pure. The contact is config/site.ts
// SUPPORT_EMAIL; without it there is no document (null → 404), never a made-up address.
export function securityTxt(email: string, origin: string, now = Date.now()): string | null {
  if (!email) return null;
  const expires = new Date(now + 365 * 86400_000).toISOString().replace(/\.\d{3}Z$/, '.000Z');
  return [
    `Contact: mailto:${email}`,
    `Expires: ${expires}`,
    `Policy: ${origin}/support`,
    `Canonical: ${origin}/.well-known/security.txt`,
    'Preferred-Languages: en',
    '',
  ].join('\n');
}
