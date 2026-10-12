import {CastlerEscrow, RazorpayXEscrow} from './adapters';
import {StubEscrow} from './stub';
import type {EscrowProvider} from './types';

export * from './types';
export {StubEscrow} from './stub';
export {CastlerEscrow, RazorpayXEscrow} from './adapters';

type Env = Record<string, string | undefined>;
let stub: StubEscrow | null = null;
/**
 * The escrow provider named by SCOPEFLOW_ESCROW_PROVIDER (castler | razorpayx | stub), or null when
 * escrow is off (the default: §11.3 tier 3 is live only after company formation and an agreement).
 * The stub is refused in production.
 */
export function escrowProvider(env: Env = process.env): EscrowProvider | null {
  const name = env.SCOPEFLOW_ESCROW_PROVIDER?.trim().toLowerCase();
  if (!name) return null;
  if (name === 'castler') return new CastlerEscrow(env);
  if (name === 'razorpayx') return new RazorpayXEscrow(env);
  if (name === 'stub' && env.NODE_ENV !== 'production') return (stub ??= new StubEscrow());
  return null;
}
