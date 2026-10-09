import {z} from 'zod';
import {scopeSchema, type Scope} from './scope';
import {templates} from './templates';

// PR D: the creator's saved templates. Content is validated with the scope schema; a template
// is a starting point, so fee, client and dates are kept as the creator saved them.
export const TEMPLATE_LIMIT = 50;
export const templateName = z.string().trim().min(2).max(80);
/** Up to 8 short tags, lower-cased and de-duplicated (e.g. "branding", "retainer"). */
export const tagsSchema = z.array(z.string().trim().toLowerCase().min(1).max(24).regex(/^[\p{L}\p{M}\p{N} &+/-]+$/u, 'Tags use letters, digits, spaces and - / + &')).max(8).transform(t => [...new Set(t)]);
export const createTemplateSchema = z.object({name: templateName, content: z.unknown(), tags: tagsSchema.optional()}).strict();
export const updateTemplateSchema = z.object({name: templateName.optional(), content: z.unknown().optional(), tags: tagsSchema.optional()}).strict().refine(x => x.name !== undefined || x.content !== undefined || x.tags !== undefined, 'Provide name, content or tags.');
export type TemplateRow = {id: string; owner: string; name: string; content: string; created: string; updated: string; tags?: string | null; revision?: number | null; share_token?: string | null; origin?: string | null};
export type TemplateView = {id: string; name: string; content: Scope; builtin: boolean; created?: string; updated?: string; tags: string[]; revision: number; share_path: string | null; origin: string | null};
export const builtinTemplates = (): TemplateView[] => templates.map(t => ({id: 'builtin:' + t.id, name: t.name, content: t.content, builtin: true, tags: [], revision: 1, share_path: null, origin: null}));
const parseTags = (raw: string | null | undefined): string[] => { try { const t = JSON.parse(raw ?? '[]'); return Array.isArray(t) ? t.filter((x): x is string => typeof x === 'string') : []; } catch { return []; } };
export const toView = (row: TemplateRow): TemplateView => ({id: row.id, name: row.name, content: JSON.parse(row.content), builtin: false, created: row.created, updated: row.updated, tags: parseTags(row.tags), revision: row.revision ?? 1, share_path: row.share_token ? `/templates/shared/${row.share_token}` : null, origin: row.origin ?? null});
/** What a share link shows: the template without its owner, ids or history. */
export const sharedView = (row: Pick<TemplateRow, 'name' | 'content' | 'tags' | 'revision' | 'updated'>) => ({name: row.name, content: JSON.parse(row.content) as Scope, tags: parseTags(row.tags), revision: row.revision ?? 1, updated: row.updated});
export const TEMPLATE_REVISIONS_KEPT = 20;
/** Validated template content or an error message. */
export function templateContent(raw: unknown): {content: Scope} | {error: string} {
  // A template may leave the client blank (it is filled in per project); everything else must be valid scope content.
  const blankClient = !!raw && typeof raw === 'object' && (raw as {client?: unknown}).client === '';
  const parsed = scopeSchema.safeParse(blankClient ? {...(raw as object), client: 'Client'} : raw);
  if (!parsed.success) return {error: parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ')};
  return {content: blankClient ? {...parsed.data, client: ''} : parsed.data};
}
