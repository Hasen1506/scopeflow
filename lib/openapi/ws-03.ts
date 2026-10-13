import type {OpenApiFragment} from './types';

// OpenAPI paths and schemas added by WS-03 (invoicing, GST documents, TDS, MSMED, evidence packs).
// Only WS-03 edits this file. The existing /api/scopes/{id}/invoices, /invoices/{seq}, /statement and
// /dispute-pack paths stay in app/api/openapi/route.ts (WS-10); their WS-03 changes are described in
// the schemas below (InvoiceRequestWs03) and in docs/ws-03.md. Change request to WS-10: point the
// invoice POST requestBody at #/components/schemas/InvoiceRequestWs03 and add ?variant to dispute-pack.
const security = [{bearerAuth: []}];
const errors = {'400': {description: 'Invalid input'}, '401': {description: 'Missing, expired, or revoked API token'}, '404': {description: 'Not found in this account'}, '409': {description: 'Conflicts with the current state (for example exceeds_uninvoiced)'}, '429': {description: 'Rate limit reached'}};
const id = {name: 'id', in: 'path', required: true, schema: {type: 'string'}};
const seq = {name: 'seq', in: 'path', required: true, schema: {type: 'integer', minimum: 1}};
const json = (ref: string) => ({required: true, content: {'application/json': {schema: {$ref: `#/components/schemas/${ref}`}}}});
const pdf = {'200': {description: 'PDF', content: {'application/pdf': {schema: {type: 'string', format: 'binary'}}}}};
const day = {type: 'string', format: 'date'};
const tds = {type: 'object', additionalProperties: false, required: ['section_2025', 'rate_pct'], properties: {
  section_2025: {enum: ['393(1) Sl.6(iii)-professional', '393(1) Sl.6(iii)-technical', '393(1) Sl.6(i)-contractor-ind-huf', '393(1) Sl.6(i)-contractor-other', '393(1) Sl.6(ii)', 'other']},
  legacy_label: {enum: ['194J(b)', '194J(a)', '194C', '194M', null]}, rate_pct: {type: 'number', exclusiveMinimum: 0, maximum: 30}, base: {const: 'taxable_value'},
}, description: 'TDS the client will deduct (Income-tax Act 2025 s.393; old 194J/194C labels for FY 2025-26 and earlier). Never defaulted. Confirm with your CA.'};

export const fragment: OpenApiFragment = {
  paths: {
    '/api/scopes/{id}/invoices/terms': {
      parameters: [id],
      get: {operationId: 'getInvoicingTerms', summary: 'The project’s TDS default, MSMED payment term and rate basis, the owner’s Udyam registration, the s.393 reference table, the MSMED clause and warnings.', security, responses: {'200': {description: 'terms'}, ...errors}},
      put: {operationId: 'putInvoicingTerms', summary: 'Set the project’s TDS default (or null), the MSMED written payment term (1–45 days) and interest rate basis, and the owner’s Udyam registration.', security, requestBody: json('InvoicingTermsInput'), responses: {'200': {description: 'terms'}, ...errors}},
    },
    '/api/scopes/{id}/invoices/receipt-vouchers': {
      parameters: [id],
      get: {operationId: 'listReceiptVouchers', summary: 'Receipt vouchers (GST rule 50, RV-0001 …) or plain payment receipts (PR-0001 …) issued for advances; issues any that are due.', security, responses: {'200': {description: 'receipt_vouchers'}, ...errors}},
    },
    '/api/scopes/{id}/invoices/receipt-vouchers/{seq}': {parameters: [id, seq], get: {operationId: 'getReceiptVoucherPdf', summary: 'A receipt voucher as PDF.', security, responses: {...pdf, ...errors}}},
    '/api/scopes/{id}/invoices/{seq}/tds-credit': {
      parameters: [id, seq],
      post: {operationId: 'recordTdsCredit', summary: 'Record the TDS certificate (Form 16A / 131) for an invoice paid net of TDS; it becomes tds_credited.', security, requestBody: json('TdsCreditInput'), responses: {'201': {description: 'invoice'}, ...errors}},
    },
    '/api/scopes/{id}/credit-notes': {
      parameters: [id],
      get: {operationId: 'listCreditNotes', summary: 'Credit notes of the project (CN-0001 …).', security, responses: {'200': {description: 'credit_notes'}, ...errors}},
      post: {operationId: 'issueCreditNote', summary: 'Issue a credit note against an invoice (CGST s.34), full (cancels it and frees the amount under the cap) or partial. Immutable once issued; request_id replays.', security, requestBody: json('CreditNoteInput'), responses: {'201': {description: 'credit_note'}, ...errors}},
    },
    '/api/scopes/{id}/credit-notes/{seq}': {parameters: [id, seq], get: {operationId: 'getCreditNotePdf', summary: 'A credit note as PDF.', security, responses: {...pdf, ...errors}}},
    '/api/scopes/{id}/acceptance': {
      parameters: [id],
      get: {operationId: 'getAcceptance', summary: 'MSMED position: acceptance (written, deemed or after an objection), the s.15 pay-by date, warnings and s.16 interest per overdue invoice (estimate — confirm with your CA).', security, responses: {'200': {description: 'msmed summary and history'}, ...errors}},
      post: {operationId: 'recordAcceptance', summary: 'Record delivery and acceptance (or a written objection and its removal) for MSMED s.2(b). Append-only.', security, requestBody: json('AcceptanceInput'), responses: {'201': {description: 'msmed summary'}, ...errors}},
    },
  },
  schemas: {
    InvoiceRequestWs03: {type: 'object', additionalProperties: false, description: 'POST /api/scopes/{id}/invoices since WS-03. Give an amount, a milestone or a change order. 409 exceeds_uninvoiced when the amount is more than is left to invoice on the agreement.', properties: {
      amount: {type: 'number', exclusiveMinimum: 0, description: 'Taxable value (GST added on top) unless includes_tax is true.'},
      includes_tax: {type: 'boolean', default: false}, description: {type: 'string', maxLength: 200}, due_days: {type: 'integer', minimum: 0, maximum: 120},
      milestone_id: {type: 'string', pattern: '^[A-Za-z0-9_-]{1,40}$'}, change_order_seq: {type: 'integer', minimum: 1},
      tds: {oneOf: [tds, {type: 'null'}]}, adjust_advances: {type: 'boolean'}, request_id: {type: 'string', pattern: '^[A-Za-z0-9_-]{8,120}$'},
    }},
    InvoicingTermsInput: {type: 'object', additionalProperties: false, properties: {
      tds: {oneOf: [tds, {type: 'null'}]},
      msmed: {type: 'object', additionalProperties: false, properties: {agreed_days: {type: ['integer', 'null'], minimum: 1, maximum: 45}, rate_basis: {enum: ['on_due_date', 'per_period']}}},
      msme_profile: {oneOf: [{type: 'null'}, {type: 'object', additionalProperties: false, required: ['udyam_number', 'registered_on', 'category'], properties: {udyam_number: {type: 'string', pattern: '^UDYAM-[A-Z]{2}-\\d{2}-\\d{7}$'}, registered_on: day, category: {enum: ['micro', 'small', 'medium']}}}]},
    }},
    TdsCreditInput: {type: 'object', additionalProperties: false, required: ['amount', 'certificate_no', 'quarter', 'received'], properties: {amount: {type: 'number', exclusiveMinimum: 0}, certificate_no: {type: 'string', minLength: 3, maxLength: 40}, form: {enum: ['16A', '131'], default: '16A'}, quarter: {type: 'string', pattern: '^Q[1-4] FY \\d{4}-\\d{2}$'}, received: day}},
    CreditNoteInput: {type: 'object', additionalProperties: false, required: ['invoice_seq', 'reason'], properties: {invoice_seq: {type: 'integer', minimum: 1}, amount: {type: 'number', exclusiveMinimum: 0, description: 'Tax-inclusive amount; omit to credit the whole invoice.'}, reason: {type: 'string', minLength: 3, maxLength: 300}, request_id: {type: 'string', pattern: '^[A-Za-z0-9_-]{8,120}$'}}},
    AcceptanceInput: {type: 'object', additionalProperties: false, required: ['delivered_on'], properties: {delivered_on: day, accepted_on: {...day, nullable: true}, objection_on: {...day, nullable: true}, objection_removed_on: {...day, nullable: true}, milestone_id: {type: ['string', 'null']}, evidence: {type: 'string', maxLength: 1000}}},
  },
};
