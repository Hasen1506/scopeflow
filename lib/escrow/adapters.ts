import {EscrowError, type EscrowCreate, type EscrowEvidence, type EscrowProvider, type EscrowState} from './types';

// Skeletons for regulated escrow partners. Castler (escrow banking with partner banks and
// SEBI-registered trustees) and RazorpayX Escrow+ (Axis Trustee / Mitcon Credentia) onboard
// businesses through KYB and a tri-party agreement, so ScopeFlow can only switch these on after
// the founder has a registered company and a signed provider agreement. Until then every method
// refuses with `escrow_unavailable`; the API calls are filled in from the provider's integration
// pack once the agreement gives access. No money path exists here before that.
type Env = Record<string, string | undefined>;
abstract class GatedEscrow implements EscrowProvider {
  abstract readonly name: string;
  protected abstract configured(env: Env): boolean;
  protected env: Env;
  constructor(env: Env = process.env) { this.env = env; }
  protected guard(): never {
    if (!this.configured(this.env) || this.env.SCOPEFLOW_ESCROW_AGREEMENT !== 'signed')
      throw new EscrowError('escrow_unavailable', `${this.name} escrow is not available: it needs a provider agreement (SCOPEFLOW_ESCROW_AGREEMENT=signed) and its API credentials.`);
    throw new EscrowError('escrow_not_integrated', `${this.name} escrow API calls are added from the provider's integration pack after the agreement.`);
  }
  async createEscrow(_input: EscrowCreate): Promise<EscrowState> { return this.guard(); }
  async fundLink(_escrowId: string, _milestoneId: string): Promise<{url: string}> { return this.guard(); }
  async release(_escrowId: string, _milestoneId: string, _evidence: EscrowEvidence): Promise<EscrowState> { return this.guard(); }
  async refund(_escrowId: string, _milestoneId: string, _amount: number): Promise<EscrowState> { return this.guard(); }
  async state(_escrowId: string): Promise<EscrowState> { return this.guard(); }
}
export class CastlerEscrow extends GatedEscrow {
  readonly name = 'castler';
  protected configured(env: Env) { return !!(env.CASTLER_CLIENT_ID?.trim() && env.CASTLER_CLIENT_SECRET?.trim()); }
}
export class RazorpayXEscrow extends GatedEscrow {
  readonly name = 'razorpayx';
  protected configured(env: Env) { return !!(env.RAZORPAYX_ESCROW_KEY_ID?.trim() && env.RAZORPAYX_ESCROW_KEY_SECRET?.trim() && env.RAZORPAYX_ESCROW_ACCOUNT?.trim()); }
}
