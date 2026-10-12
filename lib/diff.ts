import {itemsOf, formatMoney, type Item, type Scope, type ClientInput} from './scope';
import {formatDay} from './time';

export type ItemField = 'title' | 'qty' | 'unit' | 'price' | 'acceptance';
export type ScopeChange =
  | {kind: 'item_added'; item: Item}
  | {kind: 'item_removed'; item: Item}
  | {kind: 'item_changed'; before: Item; after: Item; fields: ItemField[]}
  | {kind: 'input_added'; input: ClientInput}
  | {kind: 'input_removed'; input: ClientInput}
  | {kind: 'input_changed'; before: ClientInput; after: ClientInput}
  | {kind: 'field'; field: ScalarField; label: string; before: string; after: string};

type ScalarField = 'title' | 'client' | 'fee' | 'currency' | 'revisions' | 'due' | 'exclusions' | 'notes';
export const scalarLabels: Record<ScalarField, string> = {
  title: 'Project name', client: 'Client', fee: 'Fee', currency: 'Currency', revisions: 'Revision rounds',
  due: 'Delivery date', exclusions: 'Outside this scope', notes: 'Working terms',
};
const itemFields: ItemField[] = ['title', 'qty', 'unit', 'price', 'acceptance'];
const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');

/** Pair entries by id first, then by normalised title, so legacy line items still match. */
function pair<T extends {id: string; title: string}>(before: T[], after: T[]) {
  const unmatched = new Map(before.map(x => [x.id, x]));
  const pairs: [T, T][] = [];
  const added: T[] = [];
  const pending: T[] = [];
  for (const a of after) {
    const b = unmatched.get(a.id);
    if (b) { pairs.push([b, a]); unmatched.delete(a.id); } else pending.push(a);
  }
  for (const a of pending) {
    const b = [...unmatched.values()].find(x => norm(x.title) === norm(a.title));
    if (b) { pairs.push([b, a]); unmatched.delete(b.id); } else added.push(a);
  }
  return {pairs, added, removed: [...unmatched.values()]};
}

export function semanticDiff(prev: Scope, next: Scope): ScopeChange[] {
  const changes: ScopeChange[] = [];
  const items = pair(itemsOf(prev), itemsOf(next));
  for (const [before, after] of items.pairs) {
    const fields = itemFields.filter(f => (before[f] ?? null) !== (after[f] ?? null));
    if (fields.length) changes.push({kind: 'item_changed', before, after, fields});
  }
  for (const item of items.added) changes.push({kind: 'item_added', item});
  for (const item of items.removed) changes.push({kind: 'item_removed', item});

  const inputs = pair(prev.client_inputs ?? [], next.client_inputs ?? []);
  for (const [before, after] of inputs.pairs) if (before.title !== after.title || before.due !== after.due) changes.push({kind: 'input_changed', before, after});
  for (const input of inputs.added) changes.push({kind: 'input_added', input});
  for (const input of inputs.removed) changes.push({kind: 'input_removed', input});

  for (const field of Object.keys(scalarLabels) as ScalarField[]) {
    if (prev[field] === next[field]) continue;
    const show = (s: Scope) => field === 'fee' ? formatMoney(s.fee, s.currency) : String(s[field] ?? '');
    changes.push({kind: 'field', field, label: scalarLabels[field], before: show(prev), after: show(next)});
  }
  return changes;
}

/** Plain-language one-liner per change, used by the review page and MCP responses. */
export function describeChange(c: ScopeChange, currency: string): string {
  const price = (p: number | null) => (p == null ? '' : ` · ${formatMoney(p, currency)}`);
  const amount = (i: Item) => (i.qty > 1 || i.unit ? ` ×${i.qty}${i.unit ? ' ' + i.unit : ''}` : '');
  switch (c.kind) {
    case 'item_added': return `Added: ${c.item.title}${amount(c.item)}${price(c.item.price)}`;
    case 'item_removed': return `Removed: ${c.item.title}${amount(c.item)}`;
    case 'item_changed': {
      const parts = c.fields.map(f => {
        if (f === 'title') return `renamed from “${c.before.title}”`;
        if (f === 'qty') return `quantity ${c.before.qty} → ${c.after.qty}`;
        if (f === 'unit') return `unit “${c.before.unit || '—'}” → “${c.after.unit || '—'}”`;
        if (f === 'price') return `price ${c.before.price == null ? 'unpriced' : formatMoney(c.before.price, currency)} → ${c.after.price == null ? 'unpriced' : formatMoney(c.after.price, currency)}`;
        return 'acceptance criteria updated';
      });
      return `Changed: ${c.after.title} (${parts.join('; ')})`;
    }
    case 'input_added': return `Client now provides: ${c.input.title}${c.input.due ? ' by ' + formatDay(c.input.due) : ''}`;
    case 'input_removed': return `No longer needed from client: ${c.input.title}`;
    case 'input_changed': return `Client input updated: ${c.after.title}${c.after.due ? ' by ' + formatDay(c.after.due) : ''}`;
    case 'field': return `${c.label}: ${c.before || 'not specified'} → ${c.after || 'not specified'}`;
  }
}

/** One earlier version as the diff-base rule sees it. `sent`: handed to the client (sent, shared, opened). */
export type VersionHistory = {version: number; status: string; revoked: boolean; sent: boolean};

/**
 * H2/M29: which earlier version a token holder's page compares against. Only versions the client
 * could already see qualify: sent (or opened) or decided, and never revoked; an unsent draft never
 * does, so its content cannot leak. Default: the last version this client approved, else the last
 * one sent. `compare` picks another qualifying version ("compare with v…"); anything else is ignored.
 */
export function diffBaseVersion(history: VersionHistory[], current: number, compare: number | null = null): number | null {
  const eligible = history.filter(h => h.version < current && !h.revoked && (h.sent || h.status !== 'pending'));
  if (compare !== null) return eligible.some(h => h.version === compare) ? compare : null;
  const approved = eligible.filter(h => h.status === 'approved').map(h => h.version);
  if (approved.length) return Math.max(...approved);
  return eligible.length ? Math.max(...eligible.map(h => h.version)) : null;
}
