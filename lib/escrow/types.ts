// Third-party escrow (IMPLEMENTATION_PLAN §11.3 tier 3, SF-20). Money sits in an escrow account at
// a bank, under a trustee, and is released per milestone; ScopeFlow never holds it. Pure types.

export type EscrowMilestone = {id: string; title: string; amount_minor: number};
export type EscrowParty = {name: string; email?: string; phone?: string};
export type EscrowCreate = {project_id: string; currency: string; milestones: EscrowMilestone[]; buyer: EscrowParty; seller: EscrowParty & {vpa?: string; bank?: string}};
export type EscrowMilestoneState = 'awaiting_funds' | 'funded' | 'released' | 'refunded';
export type EscrowState = {escrow_id: string; provider: string; currency: string; milestones: (EscrowMilestone & {state: EscrowMilestoneState; funded_minor: number; released_minor: number; refunded_minor: number})[]};
/** The signed record a release is checked against: ledger entries with kind and payload. */
export type EscrowEvidence = {entries: {seq: number; kind: string; payload: unknown}[]};

export interface EscrowProvider {
  readonly name: string;
  /** Opens an escrow for a project's milestones (tri-party agreement on the provider's side). */
  createEscrow(input: EscrowCreate): Promise<EscrowState>;
  /** A link where the buyer funds one milestone into the escrow account. */
  fundLink(escrowId: string, milestoneId: string): Promise<{url: string}>;
  /** Releases a funded milestone to the seller; only after the buyer approved it on the record. */
  release(escrowId: string, milestoneId: string, evidence: EscrowEvidence): Promise<EscrowState>;
  /** Returns part or all of a funded, unreleased milestone to the buyer. */
  refund(escrowId: string, milestoneId: string, amount_minor: number): Promise<EscrowState>;
  state(escrowId: string): Promise<EscrowState>;
}
export class EscrowError extends Error {
  readonly code: string;
  constructor(code: string, message: string) { super(message); this.code = code; }
}

/**
 * The release rule every adapter applies: a milestone is released only after the signed record
 * holds the client's acceptance of it: a `delivery_accepted` entry naming the milestone (WS-05),
 * or an approved `settle` of a change order that marks the milestone accepted.
 */
export function milestoneApproved(evidence: EscrowEvidence, milestoneId: string): boolean {
  return evidence.entries.some(e => {
    const p = (e.payload ?? {}) as {milestone_id?: unknown; outcome?: unknown};
    return e.kind === 'delivery_accepted' && p.milestone_id === milestoneId && (p.outcome === undefined || p.outcome === 'accepted');
  });
}
