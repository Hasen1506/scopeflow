import type {OpenApiFragment} from './types';

// OpenAPI paths and schemas added by WS-04 (payments without custody). Only WS-04 edits this file.
// Client money always goes to an account the freelancer owns (UPI, their own Razorpay or Stripe);
// amounts are integer minor units of the agreement currency.
const security = [{bearerAuth: []}];
const errors = {'400': {description: 'Invalid input'}, '401': {description: 'Missing, expired, or revoked API token'}, '404': {description: 'Not found in this account'}, '409': {description: 'Conflicts with the current state'}, '429': {description: 'Rate limit reached'}};
const id = {name: 'id', in: 'path', required: true, schema: {type: 'string'}};
const token = {name: 'token', in: 'path', required: true, schema: {type: 'string', pattern: '^[a-f0-9]{64}$'}};

export const fragment: OpenApiFragment = {
  paths: {
    '/api/payment-accounts': {
      get: {operationId: 'listPaymentAccounts', summary: 'The owner’s own payment accounts (no secrets), the route each currency would use, the webhook URL to configure per account, and payment readiness (ready | misconfigured | none).', security, responses: {'200': {description: 'accounts, routes, readiness, razorpay_oauth, route_enabled'}, ...errors}},
      post: {operationId: 'connectPaymentAccount', summary: 'Connect a UPI ID, the owner’s own Razorpay API keys, their own Stripe key, or (SCOPEFLOW_ROUTE_ENABLED) a Razorpay Route linked account. Keys are checked with the provider, then sealed at rest. Replaces the previous active account of the same kind.', security, requestBody: {required: true, content: {'application/json': {schema: {$ref: '#/components/schemas/PaymentAccountInput'}}}}, responses: {'201': {description: 'account (and a warning when no webhook secret was given)'}, '503': {description: 'Encryption key missing'}, ...errors}},
    },
    '/api/payment-accounts/{id}': {
      parameters: [id],
      delete: {operationId: 'disconnectPaymentAccount', summary: 'Stop using an account for new charges (it can still refund what it took).', security, responses: {'200': {description: 'disconnected'}, ...errors}},
    },
    '/api/payment-accounts/{id}/settlements': {
      parameters: [id],
      get: {operationId: 'paymentAccountSettlements', summary: 'Read-only settlements (Razorpay) or payouts (Stripe) of the owner’s own account.', security, responses: {'200': {description: 'items'}, '502': {description: 'Provider unreachable'}, ...errors}},
    },
    '/api/payments/claims': {
      get: {operationId: 'listPaymentClaims', summary: 'Payments clients reported ("I’ve paid", with a UTR) waiting for the owner. ?project_id filters; ?status=all includes decided ones.', security, responses: {'200': {description: 'claims'}, ...errors}},
    },
    '/api/payments/claims/{id}': {
      parameters: [id],
      post: {operationId: 'decidePaymentClaim', summary: 'Confirm (records a payment_received entry, once) or reject a client’s payment claim.', security, requestBody: {required: true, content: {'application/json': {schema: {type: 'object', additionalProperties: false, required: ['action'], properties: {action: {enum: ['confirm', 'reject']}, received: {type: 'string', format: 'date'}, note: {type: 'string', maxLength: 300}}}}}}, responses: {'200': {description: 'replayed or rejected'}, '201': {description: 'confirmed: seq'}, '500': {description: 'Could not be recorded; the owner is alerted'}, ...errors}},
    },
    '/api/payments/alerts': {
      get: {operationId: 'listPaymentAlerts', summary: 'Payment problems for the owner: excess or short captures (with a ready refund request), money or refunds not yet on the record, stale orders. ?status=all includes resolved ones.', security, responses: {'200': {description: 'alerts'}, ...errors}},
    },
    '/api/payments/alerts/{id}': {
      parameters: [id],
      post: {operationId: 'resolvePaymentAlert', summary: 'Mark a payment alert as dealt with.', security, responses: {'200': {description: 'resolved'}, ...errors}},
    },
    '/api/review/{token}/payments': {
      parameters: [token],
      get: {operationId: 'reviewPaymentOptions', summary: 'Public (review link): what is open (deposit, invoices, balance) in minor units, the freelancer’s UPI ID with a UPI URI per target (INR only), bank details, whether their own online checkout is available, and the client’s claims.', responses: {'200': {description: 'money, targets, upi, bank, online, claims, paths'}, '409': {description: 'Not approved yet'}, '410': {description: 'Link expired'}}},
    },
    '/api/review/{token}/payment-claim': {
      parameters: [token],
      post: {operationId: 'reviewPaymentClaim', summary: 'Public (review link): the client reports a UPI or bank payment with its UTR. Counts only once the owner confirms it.', requestBody: {required: true, content: {'application/json': {schema: {type: 'object', additionalProperties: false, required: ['purpose', 'amount_minor', 'method', 'utr'], properties: {purpose: {enum: ['deposit', 'invoice', 'balance']}, invoice_seq: {type: 'integer'}, amount_minor: {type: 'integer', minimum: 1}, method: {enum: ['upi', 'bank_transfer']}, utr: {type: 'string', maxLength: 40}, payer_name: {type: 'string', maxLength: 120}}}}}}, responses: {'201': {description: 'claim (UTR masked)'}, '409': {description: 'Duplicate claim or not approved'}, '400': {description: 'Invalid UTR or amount'}}},
    },
    '/api/review/{token}/payments/razorpay/verify': {
      parameters: [token],
      post: {operationId: 'reviewRazorpayVerify', summary: 'Public (review link): the Razorpay Checkout handler’s order id, payment id and signature; verified and recorded at once (idempotent with the webhook).', requestBody: {required: true, content: {'application/json': {schema: {type: 'object', additionalProperties: false, required: ['razorpay_order_id', 'razorpay_payment_id', 'razorpay_signature'], properties: {razorpay_order_id: {type: 'string'}, razorpay_payment_id: {type: 'string'}, razorpay_signature: {type: 'string'}}}}}}, responses: {'200': {description: 'recorded'}, '202': {description: 'Pending provider confirmation'}, '400': {description: 'Bad signature'}}},
    },
  },
  schemas: {
    PaymentAccountInput: {oneOf: [
      {type: 'object', additionalProperties: false, required: ['kind', 'vpa', 'payee_name'], properties: {kind: {const: 'upi'}, vpa: {type: 'string', description: 'UPI ID, name@bank'}, payee_name: {type: 'string', minLength: 2, maxLength: 50}}},
      {type: 'object', additionalProperties: false, required: ['kind', 'key_id', 'key_secret'], properties: {kind: {const: 'razorpay_keys'}, key_id: {type: 'string', pattern: '^rzp_(test|live)_'}, key_secret: {type: 'string', writeOnly: true}, webhook_secret: {type: 'string', writeOnly: true}}},
      {type: 'object', additionalProperties: false, required: ['kind', 'secret_key'], properties: {kind: {const: 'stripe_keys'}, secret_key: {type: 'string', pattern: '^(sk|rk)_(test|live)_', writeOnly: true}, webhook_secret: {type: 'string', pattern: '^whsec_', writeOnly: true}, currencies: {type: 'array', items: {type: 'string', pattern: '^[A-Z]{3}$'}}, include_inr: {type: 'boolean'}}},
      {type: 'object', additionalProperties: false, required: ['kind', 'linked_account_id'], properties: {kind: {const: 'razorpay_route'}, linked_account_id: {type: 'string', pattern: '^acc_'}}},
    ]},
  },
};
