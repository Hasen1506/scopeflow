import {db} from './server';
import {configuredOrigin} from './origin';
import {priceChangeOrder, radarBasis, type PriceSuggestion} from './radar-server';
import {embeddingConfig} from './embeddings';
import {scopeRadar, type RadarResult} from './radar';
import {tokens} from './check';
import type {ChangeOrder} from './ledger';

// Captured client requests (WS-06): the PWA share target (SF-03) and the WhatsApp forward-to-bot
// (SF-04) both turn a client's message into a capture: matched to a project (or the owner picks
// one), checked by the radar against the agreement, and a prefilled change order the owner reviews
// on /share before proposing it. Nothing is sent to the client and nothing is recorded on the ledger.

export type ProjectChoice = {id: string; title: string; client: string; last_activity: string};
export type CaptureView = {id: string; project_id: string | null; source: 'share' | 'whatsapp'; text: string; url: string | null; files: number; created: string;
  radar: null | {verdict: RadarResult['verdict']; covered: RadarResult['covered']; engine: RadarResult['engine']; reasons: string[]; citations: {id: string; kind: string; text: string}[]; reply: string; basis: string; note: string | null; change_order: Partial<ChangeOrder> | null; prices: (PriceSuggestion & {item_id: string})[]; currency: string; baseline_version: number | null; tax_pct: number; tax_label: string}};

/** The owner's open projects, most recently active first (versions, ledger entries and forwarded mail count as activity). */
export async function ownerProjects(owner: string, limit = 10): Promise<ProjectChoice[]> {
  const rows = await db().prepare(`SELECT p.id, v.content,
      GREATEST(COALESCE((SELECT MAX(created) FROM versions WHERE project_id=p.id),''), COALESCE((SELECT MAX(created) FROM ledger_entries WHERE project_id=p.id),''), COALESCE((SELECT MAX(received) FROM inbound_messages WHERE project_id=p.id),'')) AS last_activity
    FROM projects p JOIN versions v ON v.project_id=p.id AND v.version=p.latest WHERE p.owner=? AND p.archived IS NULL ORDER BY last_activity DESC, p.id LIMIT ?`).bind(owner, limit).all<{id: string; content: string; last_activity: string}>();
  return rows.results.map(r => { const c = JSON.parse(r.content) as {title?: string; client?: string}; return {id: r.id, title: c.title ?? 'Untitled', client: c.client ?? '', last_activity: r.last_activity}; });
}

/**
 * Picks the project a message is about: the one whose title or client it names (uniquely), else the
 * only open project, else the only one active in the last `days` days. Otherwise null: ask the owner.
 */
export function pickProject(text: string, projects: ProjectChoice[], now = Date.now(), days = 14): string | null {
  if (projects.length === 1) return projects[0].id;
  const words = tokens(text);
  const named = projects.filter(p => { const t = tokens(`${p.client} ${p.title}`); let n = 0; for (const w of t) if (words.has(w)) n++; return n >= Math.min(2, t.size) && n > 0; });
  if (named.length === 1) return named[0].id;
  const recent = projects.filter(p => now - Date.parse(p.last_activity || '1970-01-01') <= days * 86400_000);
  return recent.length === 1 ? recent[0].id : null;
}

/** Runs the radar for `text` against the project and prices any drafted change order. */
export async function analyze(owner: string, projectId: string, text: string) {
  const basis = await radarBasis(projectId);
  if (!basis) return null;
  const result = await scopeRadar(text, basis.scope, basis.agreement, {embeddings: embeddingConfig()});
  const priced = result.change_order ? await priceChangeOrder(owner, result.change_order, basis.agreement.currency, projectId) : {change_order: null, prices: []};
  return {
    verdict: result.verdict, covered: result.covered, engine: result.engine, reasons: result.reasons, citations: result.citations.map(c => ({id: c.id, kind: c.kind, text: c.text})),
    reply: result.reply, basis: basis.basis, note: result.note, change_order: priced.change_order, prices: priced.prices, currency: basis.agreement.currency,
    baseline_version: basis.basis === 'agreement' ? basis.agreement.baseline_version : null, tax_pct: basis.scope.tax_pct ?? 0, tax_label: basis.scope.tax_label ?? 'Tax',
  } satisfies CaptureView['radar'];
}

export async function createCapture(owner: string, c: {source: 'share' | 'whatsapp'; text: string; url?: string | null; files?: number; projectId?: string | null}) {
  const id = crypto.randomUUID();
  const radar = c.projectId ? await analyze(owner, c.projectId, c.text) : null;
  await db().prepare('INSERT INTO scopeflow.capture_drafts (id,owner,project_id,source,text,url,files,radar,created) VALUES (?,?,?,?,?,?,?,?,?)')
    .bind(id, owner, radar ? c.projectId! : null, c.source, c.text.slice(0, 4000), c.url?.slice(0, 2000) ?? null, c.files ?? 0, radar ? JSON.stringify(radar) : null, new Date().toISOString()).run();
  return {id, radar};
}
export async function assignCapture(owner: string, id: string, projectId: string) {
  const row = await db().prepare('SELECT text FROM scopeflow.capture_drafts WHERE id=? AND owner=?').bind(id, owner).first<{text: string}>();
  const project = await db().prepare('SELECT id FROM projects WHERE id=? AND owner=? AND archived IS NULL').bind(projectId, owner).first();
  if (!row || !project) return null;
  const radar = await analyze(owner, projectId, row.text);
  if (!radar) return null;
  await db().prepare('UPDATE scopeflow.capture_drafts SET project_id=?, radar=? WHERE id=? AND owner=?').bind(projectId, JSON.stringify(radar), id, owner).run();
  return radar;
}
export async function loadCapture(owner: string, id: string): Promise<CaptureView | null> {
  const row = await db().prepare('SELECT id,project_id,source,text,url,files,radar,created FROM scopeflow.capture_drafts WHERE id=? AND owner=?').bind(id, owner).first<Omit<CaptureView, 'radar'> & {radar: string | null}>();
  return row ? {...row, radar: row.radar ? JSON.parse(row.radar) : null} : null;
}
export const captureUrl = (id: string) => `${configuredOrigin() ?? ''}/share?capture=${encodeURIComponent(id)}`;
