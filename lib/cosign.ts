import {z} from 'zod';
import {sha256} from './ledger';

// Countersignatures (multi-party signing). After the client approves a version, the roles the
// creator listed (for example "Finance approver") each add their own signature to the same
// approved version. A countersignature never changes the approval or its anchor: it is a separate
// record, signed by Scopeflow over "scopeflow-cosign-v1:<anchor>:<sha256 of the cosign details>".

export const MAX_COSIGNERS = 3;
// H1: each role can carry its own signer identity (name and an email or phone). The role then gets
// its own link (/cosign/<token>) and its one-time code goes to that address, never the client's.
export const cosignerSchema = z.object({
  id: z.string().regex(/^[a-z0-9_-]{1,24}$/, 'Use 1–24 lowercase letters, digits, - or _ for the role id'),
  role: z.string().trim().min(2).max(60),
  name: z.string().trim().min(2).max(120).optional(),
  email: z.string().trim().toLowerCase().max(254).regex(/^[^\s@]+@[^\s@]+\.[^\s@]+$/, 'Enter a valid email for the countersigner').optional(),
  phone: z.string().regex(/^\+[1-9]\d{7,14}$/, 'Enter the countersigner’s phone in international form, e.g. +919876543210').optional(),
}).strict();
export const cosignersSchema = z.array(cosignerSchema).max(MAX_COSIGNERS).refine(list => new Set(list.map(c => c.id)).size === list.length, 'Each countersigning role needs its own id.');
export type Cosigner = z.infer<typeof cosignerSchema>;

export function parseCosigners(raw: string | null | undefined): Cosigner[] {
  if (!raw) return [];
  try { const parsed = cosignersSchema.safeParse(JSON.parse(raw)); return parsed.success ? parsed.data : []; } catch { return []; }
}

export type Cosign = {cosigner_id: string; role: string; signer: string; signed: string; signature: string | null; context?: Record<string, unknown> | null};
/** Canonical form signed for one countersignature. Key order is fixed, so the message is reproducible. */
export async function cosignMessage(anchor: string, c: Pick<Cosign, 'cosigner_id' | 'role' | 'signer' | 'signed'>) {
  return `scopeflow-cosign-v1:${anchor}:${await sha256(JSON.stringify({cosigner_id: c.cosigner_id, role: c.role, signer: c.signer, signed: c.signed}))}`;
}

/** Which required roles have signed and which are still waiting. Pure. Never includes a role's address. */
export function cosignStatus(required: Cosigner[], signed: Cosign[]) {
  const by = new Map(signed.map(s => [s.cosigner_id, s]));
  const roles = required.map(r => ({id: r.id, role: r.role, cosign: by.get(r.id) ?? null}));
  return {roles, waiting: roles.filter(r => !r.cosign).length, complete: roles.every(r => r.cosign)};
}
