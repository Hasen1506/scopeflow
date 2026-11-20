/**
 * Pure canonical parsing & verification helpers for locally sealed SHA-256 evidence records
 * created by the Rights & Deposit Shield (/check) and verified on /verify.
 */

export const SEAL_PREFIX = 'SHA-256 Fingerprint:';

export type ParsedSealedRecord =
  | {ok: true; body: string; expectedHash: string}
  | {ok: false; reason: string};

/**
 * Splits a pasted sealed record into its canonical hashed body and its 64-char hex fingerprint.
 * Handles Windows (\r\n) line endings and trailing whitespace cleanly.
 */
export function parseSealedEvidenceRecord(raw: string): ParsedSealedRecord {
  const normalized = raw.replace(/\r\n/g, '\n').trim();
  if (!normalized) {
    return {ok: false, reason: 'Paste the full timestamped record including the SHA-256 Fingerprint line.'};
  }
  const idx = normalized.lastIndexOf(`\n${SEAL_PREFIX}`);
  if (idx === -1) {
    return {
      ok: false,
      reason: 'Could not find a "SHA-256 Fingerprint:" line at the bottom of the pasted text.',
    };
  }
  const body = normalized.slice(0, idx);
  const hashLine = normalized.slice(idx + 1 + SEAL_PREFIX.length).trim();
  const match = hashLine.match(/^([a-f0-9]{64})$/i);
  if (!match) {
    return {
      ok: false,
      reason: 'The SHA-256 Fingerprint line must contain an exact 64-character hexadecimal hash.',
    };
  }
  if (!body.trim()) {
    return {ok: false, reason: 'The record body above the fingerprint is empty.'};
  }
  return {ok: true, body, expectedHash: match[1].toLowerCase()};
}

/** Computes lowercase hex SHA-256 using WebCrypto (works in browsers and Node 22+). */
export async function computeSha256Hex(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

export type VerifySealResult =
  | {status: 'valid'; expectedHash: string; computedHash: string}
  | {status: 'tampered'; expectedHash: string; computedHash: string}
  | {status: 'invalid_format'; reason: string};

/** Verifies a pasted sealed evidence record against its embedded SHA-256 fingerprint. */
export async function verifySealedEvidenceRecord(raw: string): Promise<VerifySealResult> {
  const parsed = parseSealedEvidenceRecord(raw);
  if (!parsed.ok) return {status: 'invalid_format', reason: parsed.reason};
  const computedHash = await computeSha256Hex(parsed.body);
  if (computedHash === parsed.expectedHash) {
    return {status: 'valid', expectedHash: parsed.expectedHash, computedHash};
  }
  return {status: 'tampered', expectedHash: parsed.expectedHash, computedHash};
}

/** Formats a sealed evidence record canonically so /check and /verify always agree byte-for-byte. */
export async function sealEvidenceText(
  noticeBody: string,
  timestampIso: string = new Date().toISOString(),
): Promise<{hash: string; timestamp: string; record: string}> {
  const cleanBody = noticeBody.replace(/\r\n/g, '\n').trimEnd();
  const fullBody = `${cleanBody}\n\nTimestamp (UTC): ${timestampIso}`;
  const hash = await computeSha256Hex(fullBody);
  return {
    hash,
    timestamp: timestampIso,
    record: `${fullBody}\n${SEAL_PREFIX} ${hash}`,
  };
}
