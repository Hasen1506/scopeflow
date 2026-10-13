'use client';
import type {Translate} from '@/lib/i18n';

/** WS-02 evidence for the decided version, as the review API serves it (`evidence`). */
export type RecordEvidence = {
  statement?: string | null; owner_session?: boolean | null; code_to?: string | null; on_file_since_text?: string | null;
  seal?: {status?: string | null; chip?: string | null; line?: string | null} | null; fingerprint?: string | null; verify_url?: string | null;
};

/** Small, plain record of how the decision was evidenced: the seal, who held the link, where the code went. */
/**
 * integration: `sealShown` — the agreement view below already shows the record's seal chip (verified in
 * the browser), so this block keeps the seal line, the honest C5 statement and the fingerprint and
 * does not repeat the chip; the page carries one seal chip.
 */
export function EvidenceBlock({evidence, t, sealShown = false}: {evidence: RecordEvidence; t: Translate; sealShown?: boolean}) {
  const {statement, owner_session, code_to, on_file_since_text, seal, fingerprint, verify_url} = evidence;
  const verifyHref = typeof verify_url === 'string' && (verify_url.startsWith('/') || verify_url.startsWith('https://')) ? verify_url : null;
  return (
    <div className="muted-box" data-testid="record-evidence" aria-labelledby="record-evidence-title">
      <p><strong id="record-evidence-title">{t('evidence.title')}</strong>{seal?.chip && !sealShown && <> <span className="chip" data-status={seal.status ?? undefined} data-testid="record-evidence-seal">{seal.chip}</span></>}</p>
      {seal?.line && <p className="fine">{seal.line}</p>}
      {statement && <p className="fine">{statement}</p>}
      {code_to && <p className="fine">{t('evidence.honest')}</p>}
      {owner_session === true && <p className="fine warn-text" data-testid="record-evidence-owner-session">{t('evidence.ownerSession')}</p>}
      {code_to && <p className="fine">{t('evidence.codeTo', {to: code_to})}</p>}
      {on_file_since_text && <p className="fine">{t('evidence.onFile', {since: on_file_since_text})}</p>}
      {fingerprint && <p className="fine mono">{t('evidence.fingerprint')}: {fingerprint}</p>}
      {verifyHref && <p className="fine"><a className="help-link" href={verifyHref}>{t('evidence.verify')}</a></p>}
    </div>
  );
}
