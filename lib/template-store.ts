import {z} from 'zod';
import {scopeSchema, type Scope} from './scope';
import {templates} from './templates';

// PR D: the creator's saved templates. Content is validated with the scope schema; a template
// is a starting point, so fee, client and dates are kept as the creator saved them.
export const TEMPLATE_LIMIT = 50;
export const templateName = z.string().trim().min(2).max(80);
export const createTemplateSchema = z.object({name: templateName, content: z.unknown()}).strict();
export const updateTemplateSchema = z.object({name: templateName.optional(), content: z.unknown().optional()}).strict().refine(x => x.name !== undefined || x.content !== undefined, 'Provide name or content.');
export type TemplateRow = {id: string; owner: string; name: string; content: string; created: string; updated: string};
export type TemplateView = {id: string; name: string; content: Scope; builtin: boolean; created?: string; updated?: string};
export const builtinTemplates = (): TemplateView[] => templates.map(t => ({id: 'builtin:' + t.id, name: t.name, content: t.content, builtin: true}));
export const toView = (row: TemplateRow): TemplateView => ({id: row.id, name: row.name, content: JSON.parse(row.content), builtin: false, created: row.created, updated: row.updated});
/** Validated template content or an error message. */
export function templateContent(raw: unknown): {content: Scope} | {error: string} {
  // A template may leave the client blank (it is filled in per project); everything else must be valid scope content.
  const blankClient = !!raw && typeof raw === 'object' && (raw as {client?: unknown}).client === '';
  const parsed = scopeSchema.safeParse(blankClient ? {...(raw as object), client: 'Client'} : raw);
  if (!parsed.success) return {error: parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ')};
  return {content: blankClient ? {...parsed.data, client: ''} : parsed.data};
}
