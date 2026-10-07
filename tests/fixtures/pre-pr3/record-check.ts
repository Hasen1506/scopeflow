import {anchorHash, verifyChain, type LedgerEntry} from './ledger';
import type {Scope} from './scope';

// The client "Verified in your browser" check exactly as it was before PR #3, at
// bda2652 (the parent of e19fa63), lifted out of app/review/[token]/agreement.tsx
// useVerification() unchanged except for being a plain async function. Used only by
// tests/differential: it is the reference the current check is compared against.
export type OldCheck = {state: 'ok'; head: string; count: number} | {state: 'failed'; detail: string};
export async function checkClientRecordPrePr3(
  scope: {project_id: string; version: number; content: Scope; signer: string | null; decided: string | null},
  ledger: {entries: LedgerEntry[]; anchors: Record<number, string>; head: string},
): Promise<OldCheck> {
  const own = await anchorHash({project_id: scope.project_id, version: scope.version, content: scope.content, signer: scope.signer, decided: scope.decided});
  if (own !== ledger.anchors[scope.version]) return {state: 'failed', detail: 'The approved scope does not match the record it is anchored to.'};
  const result = await verifyChain(ledger.entries, {...ledger.anchors, [scope.version]: own});
  if (result.intact && result.head !== ledger.head) return {state: 'failed', detail: 'The record does not reach its stated fingerprint.'};
  return result.intact ? {state: 'ok', head: result.head, count: result.count} : {state: 'failed', detail: `Entry #${result.at}: ${result.reason}.`};
}
