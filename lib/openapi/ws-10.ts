import type {OpenApiFragment} from './types';

// OpenAPI paths and schemas added by WS-10. Only WS-10 edits this file.
const date = {name: 'date', in: 'path', required: true, schema: {type: 'string', format: 'date'}, description: 'A UTC date that has ended, YYYY-MM-DD.'};
const operator = [{bearerAuth: []}];
const json = (schema: unknown, description: string) => ({description, content: {'application/json': {schema}}});
export const fragment: OpenApiFragment = {
  paths: {
    '/api/heads/{date}': {
      get: {
        summary: 'Signed ledger-head digest for a date (C7)',
        description: 'Every project ledger head at the end of the UTC date (project keyed by a hash), the SHA-256 digest of the sorted lines, the Ed25519 signature over `scopeflow-heads-v1:<date>:<digest>` and, once published, an RFC 3161 token. Pass ?project=<id> to get that project\'s line. Public; contains hashes only.',
        security: [],
        parameters: [date, {name: 'project', in: 'query', required: false, schema: {type: 'string'}}],
        responses: {200: json({$ref: '#/components/schemas/HeadDigest'}, 'The digest.'), 400: {description: 'Not a date.'}, 409: {description: 'The date has not ended yet.'}},
      },
    },
    '/api/readiness': {
      get: {
        summary: 'Operator readiness report (M30)',
        description: 'Status of every dependency /api/health ignores: signing, database role, mail, inbound, OTP, payments and webhooks, cron runs, timestamps, head digests, AI models, encryption, analytics, proxy and canonical host. Needs the operator token. Never returns secrets.',
        security: operator,
        responses: {200: json({$ref: '#/components/schemas/Readiness'}, 'The report.'), 401: {description: 'Operator token required.'}},
      },
    },
    '/api/analytics': {
      get: {
        summary: 'Activation funnel counts (SF-14)',
        description: 'Signed-in owner: their own counts and opt-out state. Operator token: counts across all accounts. Events carry no client PII.',
        parameters: [{name: 'days', in: 'query', required: false, schema: {type: 'integer', minimum: 1, maximum: 365, default: 30}}],
        responses: {200: {description: 'Funnel counts.'}, 401: {description: 'Sign in.'}},
      },
      patch: {
        summary: 'Opt this account out of (or back into) product analytics',
        requestBody: {required: true, content: {'application/json': {schema: {type: 'object', properties: {opt_out: {type: 'boolean'}}, required: ['opt_out'], additionalProperties: false}}}},
        responses: {200: {description: 'Saved.'}, 400: {description: 'Invalid input.'}, 401: {description: 'Browser session required.'}},
      },
    },
    '/api/oauth/grants': {
      get: {summary: 'Connected apps, one entry per grant (M24)', description: 'Browser session only.', responses: {200: json({type: 'object', properties: {grants: {type: 'array', items: {$ref: '#/components/schemas/OAuthGrant'}}}}, 'Grants.')}},
      delete: {summary: 'Disconnect one grant (?grant=<id>) or every connected app', parameters: [{name: 'grant', in: 'query', required: false, schema: {type: 'string'}}], responses: {200: {description: 'Disconnected.'}, 404: {description: 'Unknown grant.'}}},
    },
  },
  schemas: {
    HeadDigest: {type: 'object', properties: {date: {type: 'string'}, digest: {type: 'string'}, projects: {type: 'integer'}, heads: {type: 'array', items: {type: 'object', properties: {p: {type: 'string'}, seq: {type: 'integer'}, hash: {type: 'string'}}}}, kid: {type: ['string', 'null']}, signature: {type: ['string', 'null']}, signature_state: {type: 'string', enum: ['valid', 'invalid', 'unsigned']}, tsa: {type: ['string', 'null']}, tsa_token: {type: ['string', 'null'], description: 'Base64 RFC 3161 TimeStampToken over the digest.'}, tsa_gen_time: {type: ['string', 'null']}, published: {type: 'boolean'}}},
    Readiness: {type: 'object', properties: {status: {type: 'string', enum: ['ok', 'warn', 'fail']}, checked: {type: 'string'}, summary: {type: 'object', additionalProperties: {type: 'string', enum: ['ok', 'warn', 'off', 'fail']}}, checks: {type: 'object', additionalProperties: {type: 'object'}}}},
    OAuthGrant: {type: 'object', properties: {id: {type: 'string'}, client_id: {type: 'string'}, name: {type: 'string'}, domain: {type: 'string'}, verified: {type: 'boolean'}, scopes: {type: 'array', items: {type: 'string'}}, created: {type: 'string'}, last_used: {type: ['string', 'null']}}},
    PlatformError: {type: 'object', description: 'Every error reply (M28). `fields` on 400 validation errors; `error_id` on 500.', properties: {error: {type: 'string'}, code: {type: 'string'}, fields: {type: 'object', additionalProperties: {type: 'string'}}, error_id: {type: 'string'}, dependency: {type: 'string'}}},
  },
};
