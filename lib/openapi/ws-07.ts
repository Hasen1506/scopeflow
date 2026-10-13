import type {OpenApiFragment} from './types';

// OpenAPI paths and schemas added by WS-07. Only WS-07 edits this file.
// WS-07 adds no paths: it only names the client-page language and the optional review-GET fields the
// client page reads. The fields are served by their owners (WS-02, WS-08, H4/H10); every one is optional,
// and the page falls back when it is absent.
const nstr = {type: 'string', nullable: true};
export const fragment: OpenApiFragment = {
  paths: {},
  schemas: {
    ClientLanguage: {type: 'string', enum: ['en', 'hi', 'ta'], description: 'Client-page interface language (SF-09). Scope content is never translated.'},
    ClientReviewEvidence: {
      type: 'object', nullable: true, description: 'WS-02: how the decided version was evidenced.',
      properties: {
        statement: nstr, owner_session: {type: 'boolean', nullable: true}, code_to: nstr, on_file_since_text: nstr,
        seal: {type: 'object', nullable: true, properties: {status: nstr, chip: nstr, line: nstr}},
        fingerprint: nstr, verify_url: nstr,
      },
    },
    ClientReviewFields: {
      type: 'object', description: 'Optional fields of GET /api/review/{token} that the client page reads (WS-07).',
      properties: {
        evidence: {$ref: '#/components/schemas/ClientReviewEvidence'},
        newer_version: {type: 'integer', nullable: true, description: 'L12 (WS-02): the newer version number.'},
        newer_url: nstr,
        link_expires_text: {...nstr, description: 'WS-02: server-written expiry wording.'},
        readonly: {type: 'boolean', description: 'H4/H10: the link is closed for new changes.'},
        readonly_reason: {type: 'string', enum: ['revoked', 'rotated', 'account_closed'], nullable: true},
        account_closed: {type: 'boolean'},
        kept_until: {...nstr, format: 'date', description: 'H10: the record is kept for the client until this date.'},
        retention_days: {type: 'integer', nullable: true, description: 'M32 (WS-08): days before IP and browser are redacted.'},
        data_notice: {...nstr, description: 'WS-08: a server-written data notice line.'},
      },
    },
  },
};
