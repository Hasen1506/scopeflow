'use client';
import {useState} from 'react';
import styles from './record-evidence.module.css';

// WS-02: what a decided record proves, for the client page (WS-07 mounts it), the countersigner's
// page and the workspace (WS-09). Reads the `evidence` block of GET /api/review/<token> (or
// /api/cosign/<token>): the honest statement (§6.2), the owner-session flag (C5), the seal chip
// (§6.1, QA-03), the full fingerprint with a copy button and a prefilled "Verify this record"
// link (LT-09), and the client-contact timeline.

export type Evidence = {
  statement: string; owner_session: boolean; code_to: string | null; on_file_since: string | null; on_file_since_text?: string | null;
  acceptance: string; seal: {status: 'dedicated' | 'legacy_key' | 'unsigned' | 'invalid'; kid: string | null; chip: string; line: string};
  fingerprint: string; content_sha256: string; verify_url: string;
};
export type ContactChange = {field: string; from_masked: string | null; to_masked: string | null; reason: string; at: string};

export function OwnerSessionFlag({evidence}: {evidence: Pick<Evidence, 'owner_session'> | null | undefined}) {
  if (!evidence?.owner_session) return null;
  return <p className={styles.flag} role="note" data-owner-session="true">⚠ Submitted from a browser signed in to the creator’s account.</p>;
}

export function RecordEvidence({evidence, contactHistory = [], formatTime = (iso: string) => iso}: {evidence: Evidence; contactHistory?: ContactChange[]; formatTime?: (iso: string) => string}) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try { await navigator.clipboard.writeText(evidence.fingerprint); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { setCopied(false); }
  }
  const good = evidence.seal.status === 'dedicated' || evidence.seal.status === 'legacy_key';
  return (
    <section className={styles.box} aria-labelledby="h-evidence" data-testid="record-evidence">
      <h3 id="h-evidence">What this record shows</h3>
      <p><span className={`${styles.chip} ${good ? styles.ok : ''}`} data-seal={evidence.seal.status}>{evidence.seal.chip}</span></p>
      <p data-testid="evidence-statement">{evidence.statement}</p>
      <OwnerSessionFlag evidence={evidence} />
      {evidence.code_to && <p className="fine" data-testid="evidence-code">Code verified to {evidence.code_to}{evidence.on_file_since_text ? ` (the address on file since ${evidence.on_file_since_text})` : ''}.</p>}
      <p className="fine">{evidence.acceptance}. {evidence.seal.line}</p>
      <p className="fine">Record fingerprint</p>
      <p className={styles.fingerprint} data-testid="evidence-fingerprint">{evidence.fingerprint}</p>
      <div className={styles.row}>
        <button type="button" className="secondary" onClick={copy}>{copied ? 'Copied' : 'Copy fingerprint'}</button>
        <a className="secondary" href={evidence.verify_url}>Verify this record</a>
      </div>
      <p className="fine">The page you approved showed content with fingerprint {evidence.content_sha256.slice(0, 16)}…</p>
      {contactHistory.length > 0 && <>
        <p className="fine">Client contact changes</p>
        <ul className={styles.timeline}>{contactHistory.map(c => <li key={c.at}>{formatTime(c.at)}: {c.field} changed from {c.from_masked ?? 'none'} to {c.to_masked ?? 'none'} ({c.reason})</li>)}</ul>
      </>}
    </section>
  );
}
