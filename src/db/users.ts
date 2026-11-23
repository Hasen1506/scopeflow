import { db } from './index';
import { users } from './schema';

export async function getOrCreateUser(uid: string, email: string, displayName?: string | null) {
  try {
    const cleanEmail = (email || `${uid}@termslock.local`).trim().slice(0, 254);
    const cleanName = displayName ? displayName.trim().slice(0, 120) : null;
    const result = await db
      .insert(users)
      .values({
        uid,
        email: cleanEmail,
        displayName: cleanName,
      })
      .onConflictDoUpdate({
        target: users.uid,
        set: {
          email: cleanEmail,
          ...(cleanName ? { displayName: cleanName } : {}),
        },
      })
      .returning();
    return result[0];
  } catch (error) {
    console.error('Failed to sync user profile:', error);
    throw new Error('Could not synchronize your account profile. Please try again.', { cause: error });
  }
}
