// Where a project stands, from real records only (latest version status, its review link, the archive flag
// and the ledger's pending change orders). Pure: shared by the Projects home, the project view and the tests.
//
// Scopeflow does not track whether a review link was actually delivered to the client, so a saved, pending
// version with a working link is "Awaiting review", never "Sent". A pending version whose link is revoked is
// back to "Draft": nobody can approve it until a new link is made.

export type StageId = 'draft' | 'awaiting' | 'changes_requested' | 'approved' | 'change_pending' | 'archived';
export type StepId = 'scope' | 'approval' | 'changes' | 'payment';
export type StepState = 'done' | 'current' | 'todo' | 'attention';
export type NextKind = 'save' | 'send' | 'copy_link' | 'replace_link' | 'revise' | 'change_order' | 'restore';

export type StageInput = {
  saved: boolean;
  status?: string | null; // 'pending' | 'approved' | 'changes_requested'
  revoked?: boolean | number | null;
  archived?: boolean | string | null;
  pendingChanges?: number;
};

export const STAGE_LABEL: Record<StageId, string> = {
  draft: 'Draft',
  awaiting: 'Awaiting review', // visual #30: the same words as the Approval card (lib/scope.ts label)
  changes_requested: 'Changes requested',
  approved: 'Approved',
  change_pending: 'Change pending',
  archived: 'Archived',
};

/** The workflow stage, ignoring the archive flag (archived projects keep their underlying stage for the tracker). */
export function baseStage(i: StageInput): Exclude<StageId, 'archived'> {
  if (!i.saved) return 'draft';
  if (i.status === 'approved') return (i.pendingChanges ?? 0) > 0 ? 'change_pending' : 'approved';
  if (i.status === 'changes_requested') return 'changes_requested';
  return i.revoked ? 'draft' : 'awaiting';
}
export function stageOf(i: StageInput): StageId {
  return i.saved && i.archived ? 'archived' : baseStage(i);
}

export type Step = {id: StepId; label: string; state: StepState; note: string};
/** Scope → Approval → Changes → Payment, each with a state and a few words saying why. */
export function trackerSteps(i: StageInput): Step[] {
  const s = baseStage(i), pending = i.pendingChanges ?? 0;
  const step = (id: StepId, label: string, state: StepState, note: string): Step => ({id, label, state, note});
  switch (s) {
    case 'draft': return i.saved
      ? [step('scope', 'Scope', 'done', 'Saved'), step('approval', 'Approval', 'attention', 'Link revoked'), step('changes', 'Changes', 'todo', 'After approval'), step('payment', 'Payment', 'todo', 'After approval')]
      : [step('scope', 'Scope', 'current', 'Not saved yet'), step('approval', 'Approval', 'todo', 'Save to get a link'), step('changes', 'Changes', 'todo', 'After approval'), step('payment', 'Payment', 'todo', 'After approval')];
    case 'awaiting': return [step('scope', 'Scope', 'done', 'Saved'), step('approval', 'Approval', 'current', 'Awaiting client'), step('changes', 'Changes', 'todo', 'After approval'), step('payment', 'Payment', 'todo', 'After approval')];
    case 'changes_requested': return [step('scope', 'Scope', 'current', 'Revise it'), step('approval', 'Approval', 'attention', 'Changes requested'), step('changes', 'Changes', 'todo', 'After approval'), step('payment', 'Payment', 'todo', 'After approval')];
    case 'change_pending': return [step('scope', 'Scope', 'done', 'Saved'), step('approval', 'Approval', 'done', 'Approved'), step('changes', 'Changes', 'current', `${pending} awaiting client`), step('payment', 'Payment', 'todo', 'Agreement settling')];
    case 'approved': return [step('scope', 'Scope', 'done', 'Saved'), step('approval', 'Approval', 'done', 'Approved'), step('changes', 'Changes', 'done', 'None pending'), step('payment', 'Payment', 'current', 'Receipt ready')];
  }
}

export type Next = {kind: NextKind; title: string; detail: string};
/** The single most useful next step for a project, phrased for the freelancer. */
export function nextStep(i: StageInput & {client?: string}): Next {
  const who = i.client?.trim() || 'your client';
  if (i.saved && i.archived) return {kind: 'restore', title: 'Archived', detail: 'The signed record and links are kept. Restore the project to add versions or change orders.'};
  switch (baseStage(i)) {
    case 'draft': return i.saved
      ? {kind: 'replace_link', title: 'Make a new review link', detail: 'This version’s link is revoked, so nobody can approve it. Replace the link, then share it.'}
      : {kind: 'save', title: 'Write the scope, then save it', detail: 'Saving locks this version and creates the review link your client approves.'};
    case 'awaiting': return {kind: 'send', title: `Waiting for ${who} to approve`, detail: 'Send the review link, or copy it into your own message. The decision appears here as soon as it is made.'};
    case 'changes_requested': return {kind: 'revise', title: `${who} asked for changes`, detail: 'Edit the scope and save a new version. The new version gets its own review link.'};
    case 'change_pending': return {kind: 'copy_link', title: `Change order awaiting ${who}`, detail: 'Your client approves it on the same review link. The fee changes only once they approve.'};
    case 'approved': return {kind: 'change_order', title: 'Approved: the agreement is on record', detail: 'Download the signed receipt for your invoice. If the client asks for more, record a change order for them to approve.'};
  }
}
