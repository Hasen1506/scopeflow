// SF-15: Aadhaar eSign through a licensed eSign provider (owner: WS-02). The provider signs the
// receipt PDF with the signer's Aadhaar-based eSign certificate; ScopeFlow stores the signed PDF and
// the provider's audit trail with the record. Only such a record is called a "digital signature" (L2).

export type EsignRequest = {project_id: string; version: number; title: string; pdf: Uint8Array; signer: {name: string | null; email: string | null; phone: string | null}; callback_url: string; return_url: string};
export type EsignCreated = {document_id: string; signing_url: string};
export type EsignCompletion = {document_id: string; status: 'signed' | 'failed'; signed_pdf: Uint8Array | null; audit_trail: unknown; signer_masked: string | null};

export interface EsignProvider {
  readonly id: string;
  /** Uploads the PDF and returns where the signer signs. */
  create(request: EsignRequest): Promise<EsignCreated>;
  /** Verifies and parses a provider callback; null when its authentication fails. */
  parseCallback(raw: string, headers: Headers): Promise<EsignCompletion | null>;
}
export class EsignUnavailable extends Error {}
