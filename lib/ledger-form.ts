import {changeOrderSchema, type ChangeOrder} from './ledger';

export type LedgerForm = null | 'change_order' | 'revision_round' | 'client_input' | 'goodwill';

/**
 * Which ledger form to show after a toolbar button is pressed.
 *
 * Root cause of the "change order silently discarded" QA bug: the toolbar's
 * "Change order" button toggled the open form shut and was restyled as the primary
 * button while the form was open, so pressing it (instead of the form's own
 * "Record for client review" at the bottom of a long form) closed the form, threw
 * the typed change order away and posted nothing, with no message. Toolbar buttons
 * now only open or switch forms; closing is the form's explicit Cancel, and switching
 * away from a form with typed input asks first.
 */
export function nextForm(current: LedgerForm, requested: Exclude<LedgerForm, null>, opts: {dirty: boolean; reseed?: boolean; confirmDiscard: () => boolean}): {form: LedgerForm; reset: boolean} {
  if (current === requested && !opts.reseed) return {form: current, reset: false};
  if (current && opts.dirty && !opts.confirmDiscard()) return {form: current, reset: false};
  return {form: requested, reset: true};
}

const fieldNames: Record<string, string> = {
  title: 'Change order title', reason: 'Why this is a change', request_quote: 'Client’s request',
  fee_delta: 'Fee change', days_delta: 'Schedule change', revisions_delta: 'Extra revision rounds',
  remove_item_ids: 'Removed deliverables', add_items: 'Added deliverables',
};
const itemFields: Record<string, string> = {title: 'title', qty: 'quantity', unit: 'unit', price: 'price', acceptance: '“Done when”', id: 'id'};

/** Client-side check with the server's own schema, so a bad change order is explained inline before it is sent. */
export function changeOrderProblems(payload: ChangeOrder): string[] {
  const parsed = changeOrderSchema.safeParse(payload);
  if (parsed.success) return [];
  return parsed.error.issues.map(issue => {
    const [field, index, sub] = issue.path;
    if (field === 'add_items' && typeof index === 'number') return `Added deliverable ${index + 1}: ${itemFields[String(sub)] ?? String(sub ?? '')} ${issue.message.charAt(0).toLowerCase() + issue.message.slice(1)}`.replace(/\s+/g, ' ');
    if (field === undefined) return issue.message;
    return `${fieldNames[String(field)] ?? String(field)}: ${issue.message}`;
  });
}

/**
 * LT-14: warnings (never blocks) shown under the change-order form. A fee with nothing added means
 * the approved agreement's "Deliverables now" will not list the work the client is paying for.
 */
export function changeOrderNudges(payload: Pick<ChangeOrder, 'fee_delta' | 'add_items'>): string[] {
  const out: string[] = [];
  if (payload.fee_delta > 0 && payload.add_items.length === 0) out.push('Add the deliverable this pays for, so the agreement lists the work the client is paying for.');
  return out;
}
