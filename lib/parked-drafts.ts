import { normalizeDraft } from './editor';
import type { Scope } from './scope';

export type ParkedDraft = {
  id: string;
  savedAt: string;
  draft: Scope;
  clientEmail: string;
};

export const MAX_PARKED_DRAFTS = 12;

export function parkedDraftsKey(account: string | null | undefined): string {
  return `termslock:parked-drafts:v1:${account || 'guest'}`;
}

function fingerprint(draft: Scope, clientEmail: string): string {
  return JSON.stringify({
    title: draft.title.trim(),
    client: draft.client.trim(),
    fee: Number.isFinite(draft.fee) ? draft.fee : 0,
    deliverables: draft.deliverables.trim(),
    items: draft.items ?? [],
    exclusions: draft.exclusions.trim(),
    notes: draft.notes.trim(),
    clientEmail: clientEmail.trim().toLowerCase(),
  });
}

export function readParkedDrafts(
  storage: Pick<Storage, 'getItem'> | null | undefined,
  account: string | null | undefined,
): ParkedDraft[] {
  if (!storage) return [];
  try {
    const raw = storage.getItem(parkedDraftsKey(account));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const out: ParkedDraft[] = [];
    for (const item of parsed) {
      if (!item || typeof item !== 'object') continue;
      const id = typeof item.id === 'string' && item.id ? item.id : null;
      const savedAt = typeof item.savedAt === 'string' && item.savedAt ? item.savedAt : new Date().toISOString();
      const draft = normalizeDraft(item.draft);
      const clientEmail = typeof item.clientEmail === 'string' ? item.clientEmail : '';
      if (id && draft) out.push({ id, savedAt, draft, clientEmail });
    }
    return out.slice(0, MAX_PARKED_DRAFTS);
  } catch {
    return [];
  }
}

export function writeParkedDrafts(
  storage: Pick<Storage, 'setItem' | 'removeItem'> | null | undefined,
  account: string | null | undefined,
  list: readonly ParkedDraft[],
): void {
  if (!storage) return;
  try {
    const key = parkedDraftsKey(account);
    if (list.length === 0) {
      storage.removeItem(key);
    } else {
      storage.setItem(key, JSON.stringify(list.slice(0, MAX_PARKED_DRAFTS)));
    }
  } catch {
    // storage unavailable or quota exceeded
  }
}

export function upsertParkedDraft(
  list: readonly ParkedDraft[],
  draft: Scope,
  clientEmail: string,
  opts?: { id?: string; now?: string },
): ParkedDraft[] {
  const fp = fingerprint(draft, clientEmail);
  const existing = list.find((d) => fingerprint(d.draft, d.clientEmail) === fp);
  const id =
    opts?.id ??
    existing?.id ??
    (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? `drf_${crypto.randomUUID().replace(/-/g, '').slice(0, 10)}`
      : `drf_${Math.random().toString(36).slice(2, 12)}`);
  const entry: ParkedDraft = {
    id,
    savedAt: opts?.now ?? new Date().toISOString(),
    draft: { ...draft },
    clientEmail: clientEmail.trim(),
  };
  return [entry, ...list.filter((d) => d.id !== id && fingerprint(d.draft, d.clientEmail) !== fp)].slice(
    0,
    MAX_PARKED_DRAFTS,
  );
}

export function removeParkedDraft(list: readonly ParkedDraft[], id: string): ParkedDraft[] {
  return list.filter((d) => d.id !== id);
}
