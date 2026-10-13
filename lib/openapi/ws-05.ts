import type {OpenApiFragment} from './types';

// OpenAPI paths and schemas added by WS-05 (retainer periods, rate card). Only WS-05 edits this file.
const security = [{bearerAuth: []}];
const errors = {'400': {description: 'Invalid input'}, '401': {description: 'Missing, expired, or revoked API token'}, '404': {description: 'Not found in this account'}, '409': {description: 'Stale baseline, not a retainer, or the ledger changed'}, '429': {description: 'Rate or plan limit reached'}, '503': {description: 'Storage temporarily unavailable'}};
const id = {name: 'id', in: 'path', required: true, schema: {type: 'string'}};

export const fragment: OpenApiFragment = {
  paths: {
    '/api/scopes/{id}/periods': {
      parameters: [id],
      get: {operationId: 'getRetainerPeriods', summary: 'Retainer periods with quota counters (used / allowance per item). With ?period=YYYY-MM, also the monthly statement data: lines, usage, overage change orders, fee, tax and total in minor units.', security, parameters: [{name: 'period', in: 'query', required: false, schema: {type: 'string', pattern: '^\\d{4}-(0[1-9]|1[0-2])$'}}], responses: {'200': {description: 'baseline_version, currency, retainer, terms, statement?'}, ...errors}},
      post: {operationId: 'recordRetainerUsage', summary: 'Log retainer usage (action usage), or open/close a monthly period. Usage past a quota proposes one overage change order, priced from the rate card, for client approval; nothing is charged.', security, requestBody: {required: true, content: {'application/json': {schema: {$ref: '#/components/schemas/RetainerAction'}}}}, responses: {'200': {description: 'Idempotent replay'}, '201': {description: 'entries written, overage (qty, priced) or null, retainer counters'}, ...errors}},
    },
    '/api/rate-card': {
      get: {operationId: 'getRateCard', summary: 'The account rate card: priced items (integer minor units, tax rate, tags) and multipliers such as rush +25%', security, responses: {'200': {description: 'rate_card'}, ...errors}},
      put: {operationId: 'saveRateCard', summary: 'Replace the account rate card', security, requestBody: {required: true, content: {'application/json': {schema: {$ref: '#/components/schemas/RateCard'}}}}, responses: {'200': {description: 'rate_card'}, ...errors}},
    },
    '/api/rate-card/quote': {
      post: {operationId: 'quoteRateCardItem', summary: 'Price a rate-card item (quantity, multipliers, tax) and draft the change order for it. Records nothing. With project_id the agreement currency and tax apply.', security, requestBody: {required: true, content: {'application/json': {schema: {type: 'object', required: ['item_id'], additionalProperties: false, properties: {item_id: {type: 'string'}, qty: {type: 'number', exclusiveMinimum: 0, default: 1}, multipliers: {type: 'array', items: {type: 'string'}}, project_id: {type: 'string'}}}}}}, responses: {'200': {description: 'line, tax_label, change_order'}, ...errors}},
    },
  },
  schemas: {
    RetainerAction: {oneOf: [
      {type: 'object', additionalProperties: false, required: ['action', 'baseline_version', 'item_id', 'qty', 'date'], properties: {action: {const: 'usage'}, baseline_version: {type: 'integer', minimum: 1}, item_id: {type: 'string'}, qty: {type: 'number', exclusiveMinimum: 0}, date: {type: 'string', format: 'date'}, note: {type: 'string', maxLength: 500}, request_id: {type: 'string', pattern: '^[A-Za-z0-9_-]{8,120}$'}}},
      {type: 'object', additionalProperties: false, required: ['action', 'baseline_version', 'period'], properties: {action: {enum: ['open', 'close']}, baseline_version: {type: 'integer', minimum: 1}, period: {type: 'string', pattern: '^\\d{4}-(0[1-9]|1[0-2])$'}}},
    ]},
    RateCard: {type: 'object', additionalProperties: false, required: ['items', 'multipliers'], properties: {
      items: {type: 'array', maxItems: 200, items: {type: 'object', additionalProperties: false, required: ['id', 'title', 'unit_price_minor', 'currency'], properties: {id: {type: 'string', pattern: '^[A-Za-z0-9_-]{1,40}$'}, title: {type: 'string', minLength: 2, maxLength: 160}, unit: {type: 'string', maxLength: 40}, unit_price_minor: {type: 'integer', minimum: 0}, currency: {type: 'string', pattern: '^[A-Z]{3}$'}, tax_pct: {type: 'number', minimum: 0, maximum: 100}, tags: {type: 'array', maxItems: 20, items: {type: 'string', maxLength: 40}, description: 'Tag item:<deliverable id> to price retainer overage for that deliverable'}}}},
      multipliers: {type: 'array', maxItems: 10, items: {type: 'object', additionalProperties: false, required: ['id', 'label', 'pct'], properties: {id: {type: 'string'}, label: {type: 'string'}, pct: {type: 'number', minimum: -100, maximum: 500}}}},
    }},
  },
};
