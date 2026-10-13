import {createHmac, timingSafeEqual} from 'node:crypto';
import type {EsignCompletion, EsignCreated, EsignProvider, EsignRequest} from './types';

// Local test double for SF-15 (never in production: refused unless APP_URL is localhost). The
// callback is authenticated with HMAC-SHA256 under SCOPEFLOW_ESIGN_DOUBLE_SECRET.
type Env = Record<string, string | undefined>;
export function doubleAllowed(env: Env = process.env) {
  try { return !!env.SCOPEFLOW_ESIGN_DOUBLE_SECRET && ['localhost', '127.0.0.1'].includes(new URL(env.APP_URL ?? '').hostname); } catch { return false; }
}
export function esignDouble(env: Env = process.env): EsignProvider {
  const secret = env.SCOPEFLOW_ESIGN_DOUBLE_SECRET ?? '';
  return {
    id: 'double',
    async create(r: EsignRequest): Promise<EsignCreated> {
      const id = 'dbl_' + createHmac('sha256', secret).update(`${r.project_id}:${r.version}:${Date.now()}`).digest('hex').slice(0, 24);
      return {document_id: id, signing_url: `${r.return_url}#esign-double-${id}`};
    },
    async parseCallback(raw: string, headers: Headers): Promise<EsignCompletion | null> {
      const mac = headers.get('x-esign-signature') ?? '';
      const want = createHmac('sha256', secret).update(raw).digest('hex');
      if (!secret || mac.length !== want.length || !timingSafeEqual(Buffer.from(mac), Buffer.from(want))) return null;
      const j = JSON.parse(raw) as {document_id?: string; status?: string; signed_pdf?: string; audit_trail?: unknown; signer_masked?: string};
      if (!j.document_id) return null;
      return {document_id: j.document_id, status: j.status === 'signed' ? 'signed' : 'failed', signed_pdf: j.signed_pdf ? Buffer.from(j.signed_pdf, 'base64') : null, audit_trail: j.audit_trail ?? null, signer_masked: j.signer_masked ?? null};
    },
  };
}
