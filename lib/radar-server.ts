import {db} from './server';
import {loadLedger} from './ledger-server';
import {computeAgreement, type Agreement} from './ledger';
import type {Scope} from './scope';

/** What the radar checks a request against: the current agreement after approval, else the latest version. */
export async function radarBasis(projectId: string): Promise<{scope: Scope; agreement: Agreement; basis: 'agreement' | 'latest_version'} | null> {
  const ledger = await loadLedger(projectId);
  if (ledger.content && ledger.agreement && ledger.baseline) return {scope: ledger.content, agreement: ledger.agreement, basis: 'agreement'};
  const latest = await db().prepare('SELECT v.version,v.content FROM versions v JOIN projects p ON p.id=v.project_id AND p.latest=v.version WHERE p.id=?').bind(projectId).first<{version: number; content: string}>();
  if (!latest) return null;
  const scope = JSON.parse(latest.content) as Scope;
  return {scope, agreement: computeAgreement(scope, latest.version, []), basis: 'latest_version'};
}
