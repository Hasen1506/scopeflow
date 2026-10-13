import {createHmac, timingSafeEqual} from 'node:crypto';
import type {EsignCompletion, EsignCreated, EsignProvider, EsignRequest} from './types';
import {EsignUnavailable} from './types';

// Leegality adapter (SF-15). Needs a Leegality account: LEEGALITY_AUTH_TOKEN (API token),
// LEEGALITY_PRIVATE_SALT (webhook MAC key) and optionally LEEGALITY_BASE_URL (sandbox by default)
// and LEEGALITY_PROFILE_ID (the workflow/profile with Aadhaar eSign enabled). Field names follow
// Leegality's v3.1 "sign request" API; confirm them against the account's API docs before going live.

type Env = Record<string, string | undefined>;
export function leegalityConfig(env: Env = process.env) {
  if (!env.LEEGALITY_AUTH_TOKEN || !env.LEEGALITY_PRIVATE_SALT) return null;
  return {token: env.LEEGALITY_AUTH_TOKEN, salt: env.LEEGALITY_PRIVATE_SALT, base: (env.LEEGALITY_BASE_URL || 'https://sandbox.leegality.com').replace(/\/$/, ''), profile: env.LEEGALITY_PROFILE_ID || null};
}

export function leegality(env: Env = process.env): EsignProvider {
  const config = leegalityConfig(env);
  return {
    id: 'leegality',
    async create(r: EsignRequest): Promise<EsignCreated> {
      if (!config) throw new EsignUnavailable('Leegality is not configured (LEEGALITY_AUTH_TOKEN, LEEGALITY_PRIVATE_SALT).');
      const res = await fetch(`${config.base}/api/v3.1/sign/request`, {
        method: 'POST', headers: {'Content-Type': 'application/json', 'X-Auth-Token': config.token},
        body: JSON.stringify({
          ...(config.profile ? {profileId: config.profile} : {}),
          file: {name: `${r.title.slice(0, 60)} v${r.version}.pdf`, file: Buffer.from(r.pdf).toString('base64')},
          invitees: [{name: r.signer.name ?? 'Client', email: r.signer.email ?? undefined, phone: r.signer.phone ?? undefined, signatures: [{type: 'AADHAAR'}]}],
          irn: `${r.project_id}:${r.version}`, callbackUrl: r.callback_url, redirectUrl: r.return_url,
        }),
        signal: AbortSignal.timeout(15_000),
      });
      const body = await res.json().catch(() => null) as {status?: number; data?: {documentId?: string; invitees?: {signUrl?: string}[]}} | null;
      const id = body?.data?.documentId, url = body?.data?.invitees?.[0]?.signUrl;
      if (!res.ok || !id || !url) throw new EsignUnavailable('Leegality did not accept the document.');
      return {document_id: id, signing_url: url};
    },
    async parseCallback(raw: string, headers: Headers): Promise<EsignCompletion | null> {
      if (!config) return null;
      const mac = headers.get('x-leegality-mac') ?? headers.get('mac') ?? '';
      const want = createHmac('sha1', config.salt).update(raw).digest('hex');
      if (mac.length !== want.length || !timingSafeEqual(Buffer.from(mac), Buffer.from(want))) return null;
      const j = JSON.parse(raw) as {documentId?: string; documentStatus?: string; files?: string[]; auditTrail?: string; signer?: {name?: string}};
      if (!j.documentId) return null;
      const pdf = j.files?.[0] ? Buffer.from(j.files[0], 'base64') : null;
      return {document_id: j.documentId, status: j.documentStatus === 'COMPLETED' || j.documentStatus === 'SIGNED' ? 'signed' : 'failed', signed_pdf: pdf, audit_trail: j.auditTrail ?? null, signer_masked: null};
    },
  };
}
