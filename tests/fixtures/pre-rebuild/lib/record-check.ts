import {anchorHash, verifyChain, type LedgerEntry} from './ledger';
import type {Scope} from './scope';

// The "Verified in your browser" check on the client review page, as a pure function so
// the exact same code runs in the browser and in the differential tests.

export type SealState = 'valid' | 'invalid' | 'unsigned';
export type RecordCheck = {state: 'ok'; head: string; count: number; signed: boolean} | {state: 'failed'; detail: string};
export type CheckedScope = {project_id: string; version: number; content: Scope; signer: string | null; decided: string | null};
export type CheckedLedger = {entries: LedgerEntry[]; anchors: Record<number, string>; head: string; seal?: {state: SealState}};

/** Recomputes the record's fingerprints locally, so the client does not have to trust the server's word. */
export async function checkClientRecord(scope: CheckedScope, ledger: CheckedLedger): Promise<RecordCheck> {
  const own = await anchorHash({project_id: scope.project_id, version: scope.version, content: scope.content, signer: scope.signer, decided: scope.decided});
  if (own !== ledger.anchors[scope.version]) return {state: 'failed', detail: 'The approved scope does not match the record it is anchored to.'};
  const result = await verifyChain(ledger.entries, {...ledger.anchors, [scope.version]: own});
  if (!result.intact) return {state: 'failed', detail: `Entry #${result.at}: ${result.reason}.`};
  if (result.head !== ledger.head) return {state: 'failed', detail: 'The record does not reach its stated fingerprint.'};
  // SF-04: recomputed hashes alone cannot prove the record was not rewritten in the
  // database; the server's signatures (keyed outside the database) must also hold.
  if (ledger.seal?.state === 'invalid') return {state: 'failed', detail: 'The record’s signatures do not match its contents, so it was changed after it was recorded.'};
  return {state: 'ok', head: result.head, count: result.count, signed: ledger.seal?.state === 'valid'};
}
