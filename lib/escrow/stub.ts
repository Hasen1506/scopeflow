import {EscrowError, milestoneApproved, type EscrowCreate, type EscrowEvidence, type EscrowProvider, type EscrowState} from './types';

// In-memory escrow provider for CI and local development: same rules as a real adapter (fund,
// release only after the milestone's acceptance is on the record, refund only unreleased money).
export class StubEscrow implements EscrowProvider {
  readonly name = 'stub';
  private escrows = new Map<string, EscrowState>();
  private seq = 0;
  async createEscrow(input: EscrowCreate): Promise<EscrowState> {
    if (!input.milestones.length) throw new EscrowError('no_milestones', 'An escrow needs at least one milestone.');
    if (input.milestones.some(m => !Number.isSafeInteger(m.amount_minor) || m.amount_minor <= 0)) throw new EscrowError('bad_amount', 'Milestone amounts must be positive minor units.');
    const escrow_id = `esc_stub_${++this.seq}`;
    const state: EscrowState = {escrow_id, provider: this.name, currency: input.currency, milestones: input.milestones.map(m => ({...m, state: 'awaiting_funds', funded_minor: 0, released_minor: 0, refunded_minor: 0}))};
    this.escrows.set(escrow_id, state);
    return structuredClone(state);
  }
  private milestone(escrowId: string, milestoneId: string) {
    const e = this.escrows.get(escrowId);
    if (!e) throw new EscrowError('not_found', 'Escrow not found.');
    const m = e.milestones.find(x => x.id === milestoneId);
    if (!m) throw new EscrowError('not_found', 'Milestone not found.');
    return {e, m};
  }
  async fundLink(escrowId: string, milestoneId: string) {
    const {m} = this.milestone(escrowId, milestoneId);
    return {url: `https://escrow.stub.test/fund/${escrowId}/${encodeURIComponent(m.id)}`};
  }
  /** Test hook: the buyer's money arrives in the escrow account. */
  fund(escrowId: string, milestoneId: string) {
    const {m} = this.milestone(escrowId, milestoneId);
    if (m.state !== 'awaiting_funds') throw new EscrowError('bad_state', 'This milestone is already funded.');
    m.funded_minor = m.amount_minor; m.state = 'funded';
  }
  async release(escrowId: string, milestoneId: string, evidence: EscrowEvidence) {
    const {e, m} = this.milestone(escrowId, milestoneId);
    if (m.state !== 'funded') throw new EscrowError('not_funded', 'Only a funded milestone can be released.');
    if (!milestoneApproved(evidence, milestoneId)) throw new EscrowError('not_approved', 'The client has not accepted this milestone on the record yet.');
    m.released_minor = m.funded_minor - m.refunded_minor; m.state = 'released';
    return structuredClone(e);
  }
  async refund(escrowId: string, milestoneId: string, amount_minor: number) {
    const {e, m} = this.milestone(escrowId, milestoneId);
    if (m.state !== 'funded') throw new EscrowError('bad_state', 'Only funded, unreleased money can be refunded.');
    if (!(amount_minor > 0) || m.refunded_minor + amount_minor > m.funded_minor) throw new EscrowError('refund_exceeds', 'More than is held for this milestone.');
    m.refunded_minor += amount_minor;
    if (m.refunded_minor === m.funded_minor) m.state = 'refunded';
    return structuredClone(e);
  }
  async state(escrowId: string) {
    const e = this.escrows.get(escrowId);
    if (!e) throw new EscrowError('not_found', 'Escrow not found.');
    return structuredClone(e);
  }
}
