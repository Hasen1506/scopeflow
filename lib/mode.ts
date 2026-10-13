// Workspace modes (owner: WS-08, plan §7): the Phase 0 contract module. Everything pure lives
// in lib/mode-core.ts (safe for client components); this file adds currentMode(), which reads the
// database lazily so it stays importable from pure tests. Server code imports from here.
import {isMode, type Mode} from './mode-core';
export * from './mode-core';

/**
 * The mode of `owner`'s workspace, or of one project when `projectId` has an override.
 * Defaults to freelancer (no settings row, or the database is unreachable, e.g. in pure tests).
 */
export async function currentMode(owner: string, projectId?: string): Promise<Mode> {
  try {
    const {db} = await import('./server');
    if (projectId) {
      const p = await db().prepare('SELECT p.mode AS project_mode, s.mode AS account_mode FROM projects p LEFT JOIN account_settings s ON s.owner=p.owner WHERE p.id=? AND p.owner=?').bind(projectId, owner).first<{project_mode: string | null; account_mode: string | null}>();
      if (p) return isMode(p.project_mode) ? p.project_mode : isMode(p.account_mode) ? p.account_mode : 'freelancer';
    }
    const row = await db().prepare('SELECT mode FROM account_settings WHERE owner=?').bind(owner).first<{mode: string | null}>();
    return isMode(row?.mode) ? row.mode : 'freelancer';
  } catch {
    return 'freelancer';
  }
}
