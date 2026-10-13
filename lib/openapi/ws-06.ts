import type {OpenApiFragment} from './types';

// OpenAPI paths and schemas added by WS-06 (client notifications, share capture, WhatsApp bot, mail
// webhooks). Only WS-06 edits this file. Routes WS-06 changed but did not add (send, draft, inbound)
// keep their base entries; their new answers are described in docs/ws-06.md.
const security = [{bearerAuth: []}];
const errors = {'400': {description: 'Invalid input'}, '401': {description: 'Missing, expired, or revoked credential'}, '403': {description: 'Origin not allowed, or the credential cannot change projects'}, '404': {description: 'Not found in this account'}, '429': {description: 'Rate limit reached'}, '503': {description: 'Storage temporarily unavailable, or the feature is not configured on this server'}};
const id = {name: 'id', in: 'path', required: true, schema: {type: 'string'}};
const email = {type: ['object', 'null'], properties: {status: {type: 'string', enum: ['sent', 'dev_log', 'queued', 'failed', 'refused', 'suppressed', 'no_provider', 'skipped', 'not_sent']}, at: {type: ['string', 'null']}}};

export const fragment: OpenApiFragment = {
  paths: {
    '/api/scopes/{id}/notifications': {
      parameters: [id],
      get: {operationId: 'getClientNotifications', summary: 'What the client was told: per change order and invoice, the email status (change orders proposed and invoices issued are emailed to the client through the mail router, from any route or MCP, unless notify_client is off). Sends any notice still queued. The WhatsApp share details (review link) are returned to browser sessions only.', security, responses: {'200': {description: 'notify_client, client_email, share, change_orders, invoices', content: {'application/json': {schema: {$ref: '#/components/schemas/Ws06Notifications'}}}}, ...errors}},
      patch: {operationId: 'setClientNotifications', summary: 'Switch the client emails for change orders, invoices and payment reminders off or on for this project (default on). Contact-change notices and countersign invitations are always sent.', security, requestBody: {required: true, content: {'application/json': {schema: {type: 'object', required: ['notify_client'], additionalProperties: false, properties: {notify_client: {type: 'boolean'}}}}}}, responses: {'200': {description: 'notify_client'}, ...errors}},
      post: {operationId: 'recordShared', summary: 'Record that the owner shared the review link themselves (WhatsApp or copied link); this counts as sending it', security, requestBody: {required: true, content: {'application/json': {schema: {type: 'object', required: ['shared'], additionalProperties: false, properties: {shared: {type: 'string', enum: ['whatsapp', 'link']}}}}}}, responses: {'200': {description: 'recorded'}, ...errors}},
    },
    '/api/share': {
      post: {operationId: 'shareCapture', summary: 'PWA Web Share Target (browser session only, never an API token). multipart/form-data {title, text, url, files} from the installed app answers 303 to /share?capture=…; JSON {text, url?} answers 201 {capture_id}. The message is checked by the radar against the matched project (or the owner picks one). Nothing is sent or recorded.', requestBody: {required: true, content: {'multipart/form-data': {schema: {type: 'object', properties: {title: {type: 'string'}, text: {type: 'string', maxLength: 4000}, url: {type: 'string'}, files: {type: 'array', items: {type: 'string', format: 'binary'}}}}}, 'application/json': {schema: {type: 'object', required: ['text'], additionalProperties: false, properties: {text: {type: 'string', maxLength: 4000}, url: {type: 'string', maxLength: 2000}}}}}}, responses: {'201': {description: 'capture_id'}, '303': {description: 'To /share'}, ...errors}},
      get: {operationId: 'getShareCapture', summary: 'A capture (browser session only): the shared text, the radar verdict with cited clauses and the prefilled change order, the open projects and the review link', parameters: [{name: 'capture', in: 'query', required: true, schema: {type: 'string', format: 'uuid'}}], responses: {'200': {description: 'capture, projects, review'}, ...errors}},
      patch: {operationId: 'assignShareCapture', summary: 'Check a capture against the project the owner picked (browser session only)', requestBody: {required: true, content: {'application/json': {schema: {type: 'object', required: ['capture_id', 'project_id'], additionalProperties: false, properties: {capture_id: {type: 'string', format: 'uuid'}, project_id: {type: 'string'}}}}}}, responses: {'200': {description: 'capture, review'}, ...errors}},
    },
    '/api/whatsapp/link': {
      get: {operationId: 'getWhatsAppLink', summary: 'The owner\'s phone linked to the Scopeflow WhatsApp bot (masked), and the consent text (browser session only)', responses: {'200': {description: 'configured, linked, bot_number, consent'}, ...errors}},
      post: {operationId: 'linkWhatsApp', summary: 'Link a phone to the bot: {phone, consent: true} sends a one-time code on WhatsApp; {phone, code} confirms it (browser session only)', requestBody: {required: true, content: {'application/json': {schema: {type: 'object', required: ['phone'], properties: {phone: {type: 'string', pattern: '^\\+[1-9]\\d{7,14}$'}, consent: {const: true}, code: {type: 'string', pattern: '^\\d{6}$'}}}}}}, responses: {'200': {description: 'Code sent or phone linked'}, ...errors}},
      delete: {operationId: 'unlinkWhatsApp', summary: 'Unlink the phone (browser session only)', responses: {'200': {description: 'Unlinked'}, ...errors}},
    },
    '/api/whatsapp/webhook': {
      get: {operationId: 'verifyWhatsAppWebhook', summary: 'Meta subscription check (hub.mode, hub.verify_token = WHATSAPP_VERIFY_TOKEN, hub.challenge)', responses: {'200': {description: 'The challenge'}, '403': {description: 'Wrong verify token'}, '503': {description: 'Not configured'}}},
      post: {operationId: 'whatsAppWebhook', summary: 'WhatsApp Cloud API webhook for the forward-to-bot. Signed with X-Hub-Signature-256 (the app secret); unsigned or wrongly signed deliveries are refused. Replies only to the linked owner who wrote; never messages a client.', parameters: [{name: 'X-Hub-Signature-256', in: 'header', required: true, schema: {type: 'string', pattern: '^sha256=[0-9a-f]{64}$'}}], responses: {'200': {description: 'received, results'}, '401': {description: 'Invalid signature'}, '413': {description: 'Payload too large'}, '503': {description: 'Not configured'}}},
    },
    '/api/mail/events/{provider}': {
      parameters: [{name: 'provider', in: 'path', required: true, schema: {type: 'string', enum: ['resend', 'postmark', 'ses']}}],
      post: {operationId: 'mailProviderEvent', summary: 'Bounce and complaint webhooks from the mail providers (Resend: Svix signature with RESEND_WEBHOOK_SECRET; Postmark: HTTP Basic password SCOPEFLOW_MAIL_WEBHOOK_SECRET; SES via SNS: ?token=SCOPEFLOW_MAIL_WEBHOOK_SECRET). A hard bounce or complaint adds the address to the one suppression list used by every provider.', responses: {'200': {description: 'received, suppressed, reason; duplicate for a retried event'}, '401': {description: 'Invalid signature or password'}, '503': {description: 'Not configured'}}},
    },
    '/api/mail/unsubscribe': {
      get: {operationId: 'unsubscribePage', summary: 'Unsubscribe from reminder emails (signed link from List-Unsubscribe); review links, codes and change-order notices still arrive', parameters: [{name: 't', in: 'query', required: true, schema: {type: 'string'}}], responses: {'200': {description: 'Confirmation page'}, '400': {description: 'Invalid link'}}},
      post: {operationId: 'unsubscribeOneClick', summary: 'RFC 8058 one-click unsubscribe from reminder emails', parameters: [{name: 't', in: 'query', required: true, schema: {type: 'string'}}], responses: {'200': {description: 'unsubscribed'}, '400': {description: 'Invalid link'}}},
    },
    '/api/notify/drain': {
      post: {operationId: 'drainNotifications', summary: 'Cron: send queued client notices and retry outbox mail (bearer SCOPEFLOW_CRON_SECRET)', responses: {'200': {description: 'processed, delivered, statuses'}, '401': {description: 'Unauthorized'}, '503': {description: 'SCOPEFLOW_CRON_SECRET is not set'}}},
    },
  },
  schemas: {
    Ws06Notifications: {type: 'object', properties: {
      notify_client: {type: 'boolean'}, client_email: {type: 'boolean', description: 'Whether the project has a client email on file'},
      share: {type: ['object', 'null'], description: 'Browser sessions only', properties: {phone: {type: ['string', 'null']}, lang: {type: ['string', 'null']}, client: {type: 'string'}, title: {type: 'string'}, link: {type: 'string'}}},
      change_orders: {type: 'array', items: {type: 'object', properties: {seq: {type: 'integer'}, title: {type: 'string'}, status: {type: 'string'}, amount: {type: ['string', 'null'], description: 'Formatted, tax included'}, email}}},
      invoices: {type: 'array', items: {type: 'object', properties: {seq: {type: 'integer'}, number: {type: 'string'}, amount: {type: 'string'}, due: {type: ['string', 'null']}, email}}},
    }},
  },
};
