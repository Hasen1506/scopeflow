import {z} from 'zod';
import {db, json, ownerAuth, body, safeOrigin, allowWrite, allowRead, failure} from '@/lib/server';
import {MODES, currentMode, featuresFor, modeDefaults, type Mode} from '@/lib/mode';
import {DEFAULT_RETENTION_DAYS} from '@/lib/settings';
import {auditEvent} from '@/lib/billing';
// SF-17: the workspace mode (Freelancer / Agency / Consumer / Enterprise) of the account, or the
// override of one project (?project=<id>). GET returns the mode, its defaults and every feature
// in the mode's order (all features in every mode). PUT {mode, project_id?} changes it;
// project_id with mode null clears a project's override. Switching the account to Enterprise
// sets the default 180-day retention policy when none is set (Enterprise requires one).
const put = z.object({mode: z.enum(MODES as unknown as [Mode, ...Mode[]]).nullable(), project_id: z.string().min(1).max(120).optional()}).strict()
  .refine(v => v.mode !== null || v.project_id, 'Choose a mode.');
export async function GET(request: Request) {
  try {
    const auth = await ownerAuth(request);
    if (!auth) return json({error: 'Sign in or provide a valid API token.'}, 401);
    if (!await allowRead('owner:' + auth.user)) return json({error: 'Too many requests. Try again in a minute.'}, 429);
    const project = new URL(request.url).searchParams.get('project') ?? undefined;
    if (project && !await db().prepare('SELECT 1 FROM projects WHERE id=? AND owner=? AND owner_deleted IS NULL').bind(project, auth.user).first()) return json({error: 'Project not found.'}, 404);
    const account = await currentMode(auth.user), mode = project ? await currentMode(auth.user, project) : account;
    return json({mode, account_mode: account, project_override: project ? (mode === account ? null : mode) : undefined, defaults: modeDefaults(mode), features: featuresFor(mode), modes: MODES});
  } catch (e) { return failure(e); }
}
export async function PUT(request: Request) {
  try {
    if (!safeOrigin(request)) return json({error: 'Origin not allowed.'}, 403);
    const auth = await ownerAuth(request);
    if (!auth) return json({error: 'Sign in or provide a valid API token.'}, 401);
    if (!auth.scopes.includes('scopes:write')) return json({error: 'This credential cannot change settings.'}, 403);
    if (!await allowWrite('owner:' + auth.user)) return json({error: 'Write limit reached. Try again in a minute.'}, 429);
    let raw; try { raw = await body(request); } catch { return json({error: 'Provide valid JSON under 24 KB.'}, 400); }
    const p = put.safeParse(raw);
    if (!p.success) return json({error: 'Choose freelancer, agency, consumer or enterprise.'}, 400);
    const {mode, project_id} = p.data, now = new Date().toISOString();
    if (project_id) {
      const row = await db().prepare('UPDATE projects SET mode=? WHERE id=? AND owner=? AND owner_deleted IS NULL RETURNING id').bind(mode, project_id, auth.user).first();
      if (!row) return json({error: 'Project not found.'}, 404);
      await auditEvent(auth.user, 'mode.project_changed', {project_id, mode}, auth.via);
    } else {
      const before = await currentMode(auth.user);
      // Enterprise needs a retention policy; keep the owner's own period, else set the 180-day default.
      await db().prepare(`INSERT INTO account_settings (owner,mode,context_retention_days,updated) VALUES (?,?,?,?) ON CONFLICT (owner) DO UPDATE SET mode=excluded.mode,context_retention_days=CASE WHEN excluded.mode='enterprise' THEN greatest(coalesce(account_settings.context_retention_days, ?), 30) ELSE account_settings.context_retention_days END,updated=excluded.updated`)
        .bind(auth.user, mode, mode === 'enterprise' ? DEFAULT_RETENTION_DAYS : null, now, DEFAULT_RETENTION_DAYS).run();
      if (before !== mode) await auditEvent(auth.user, 'mode.changed', {from: before, to: mode}, auth.via);
    }
    const effective = await currentMode(auth.user, project_id);
    return json({mode: effective, defaults: modeDefaults(effective), features: featuresFor(effective)});
  } catch (e) { return failure(e); }
}
