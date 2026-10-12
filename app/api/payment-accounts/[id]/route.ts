import {json, ownerAuth, safeOrigin, failure} from '@/lib/server';
import {accountById, accountSecret, disconnectAccount} from '@/lib/payment-accounts-server';
import {partnerConfig} from '@/lib/payment-accounts';
import {revokeToken} from '@/lib/razorpay';
type Ctx = {params: Promise<{id: string}>};

// Disconnects one of the owner's payment accounts: no new charges go to it. Payments it already
// took can still be looked up and refunded through it; a connected Razorpay OAuth grant is revoked.
export async function DELETE(request: Request, ctx: Ctx) {
  try {
    if (!safeOrigin(request)) return json({error: 'Origin not allowed.'}, 403);
    const auth = await ownerAuth(request);
    if (!auth) return json({error: 'Sign in or provide a valid API token.'}, 401);
    if (!auth.scopes.includes('scopes:write')) return json({error: 'This credential cannot change payment accounts.'}, 403);
    const {id} = await ctx.params;
    const account = await accountById(id);
    if (!account || account.owner !== auth.user) return json({error: 'Payment account not found.'}, 404);
    if (!await disconnectAccount(auth.user, id)) return json({disconnected: true, replayed: true});
    const partner = partnerConfig();
    if (account.kind === 'razorpay_oauth' && partner) { const s = await accountSecret(id); if (s.access_token) await revokeToken(partner, s.access_token); }
    return json({disconnected: true});
  } catch (e) { return failure(e); }
}
