import {db} from './server';
import {getAuth} from './auth/server';

// The owner's own sign-in address and whether the auth provider verified it (WS-06). Read from the
// owner's browser session on the routes that send mail, and kept in scopeflow.owner_contacts for
// the inbound allow-list (L7) and the "<Business> via ScopeFlow" display name (M19).

export type OwnerContact = {email: string; verified: boolean};
/** Refreshes the stored contact from the current browser session. Never throws. */
export async function recordOwnerContact(owner: string, fallbackEmail?: string | null): Promise<OwnerContact | null> {
  let email = fallbackEmail ?? null, verified = false;
  try {
    const {data} = await getAuth().getSession({query: {disableCookieCache: 'true'}});
    const user = data?.user as {id?: string; email?: string; emailVerified?: boolean} | undefined;
    if (user?.id === owner && user.email) { email = user.email; verified = user.emailVerified === true; }
  } catch { /* keep the fallback */ }
  if (!email) return null;
  try {
    await db().prepare('INSERT INTO scopeflow.owner_contacts (owner,email,email_verified,updated) VALUES (?,?,?,?) ON CONFLICT (owner) DO UPDATE SET email=excluded.email, email_verified=excluded.email_verified, updated=excluded.updated')
      .bind(owner, email.trim().toLowerCase().slice(0, 254), verified, new Date().toISOString()).run();
  } catch { /* advisory */ }
  return {email: email.toLowerCase(), verified};
}
export async function ownerContact(owner: string): Promise<OwnerContact | null> {
  const row = await db().prepare('SELECT email,email_verified FROM scopeflow.owner_contacts WHERE owner=?').bind(owner).first<{email: string; email_verified: boolean}>();
  return row ? {email: row.email, verified: !!row.email_verified} : null;
}

// WS-02's contact lock reads projects.first_sent (migration 0017, merged before WS-06). Until it
// exists in a database, marking is skipped; the column check is cached per process.
let firstSentColumn: boolean | null = null;
export async function markFirstSent(projectId: string) {
  try {
    if (firstSentColumn === null) firstSentColumn = !!(await db().prepare("SELECT 1 AS ok FROM information_schema.columns WHERE table_schema='scopeflow' AND table_name='projects' AND column_name='first_sent'").first());
    if (firstSentColumn) await db().prepare('UPDATE projects SET first_sent=COALESCE(first_sent, ?) WHERE id=?').bind(new Date().toISOString(), projectId).run();
  } catch { /* advisory */ }
}
