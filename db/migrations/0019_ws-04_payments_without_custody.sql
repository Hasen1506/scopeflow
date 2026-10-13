-- WS-04: payments without custody (C3, C4, H6-H9, H14, M20, M21, L4, LT-02, SF-02, SF-20).
-- Additive and idempotent. Money never passes through ScopeFlow: every online charge names a
-- freelancer-owned destination (payment_accounts); the operator's own keys are only for
-- ScopeFlow's subscription billing (refused for client charges in production).

-- The freelancer's own payment destinations. Secrets (API key secrets, OAuth tokens, webhook
-- secrets) are AES-256-GCM sealed (webhook secrets in their own column, webhook_secret_box) with SCOPEFLOW_ENCRYPTION_KEY (lib/payment-accounts.ts);
-- `public` holds only what may be shown (UPI ID, payee name, key id, account id, mode).
CREATE TABLE IF NOT EXISTS scopeflow.payment_accounts (
  id text PRIMARY KEY,
  owner text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('upi', 'razorpay_keys', 'razorpay_oauth', 'razorpay_route', 'stripe_keys')),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disconnected')),
  public text NOT NULL DEFAULT '{}',
  secret_enc text,
  -- The webhook signing secret, sealed on its own (NULL = none: readiness warns, payments are not enabled).
  webhook_secret_box text,
  created text NOT NULL,
  updated text NOT NULL,
  disconnected_at text
);
-- One active account of each kind per owner.
CREATE UNIQUE INDEX IF NOT EXISTS idx_payment_accounts_active ON scopeflow.payment_accounts(owner, kind) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_payment_accounts_owner ON scopeflow.payment_accounts(owner);

-- Razorpay OAuth (Technology Partner) state values: single use, ten minutes.
CREATE TABLE IF NOT EXISTS scopeflow.payment_oauth_states (
  state text PRIMARY KEY,
  owner text NOT NULL,
  provider text NOT NULL,
  created text NOT NULL,
  used text
);

-- Provider orders / checkout sessions: which account took them, whether a newer open amount
-- replaced them (H8), the idempotency key and expiry of Stripe sessions, what was actually
-- captured (M20) and the outcome, and the L4 manual-review flag.
ALTER TABLE scopeflow.payments ADD COLUMN IF NOT EXISTS account_id text;
ALTER TABLE scopeflow.payments ADD COLUMN IF NOT EXISTS superseded_at text;
ALTER TABLE scopeflow.payments ADD COLUMN IF NOT EXISTS idem_key text;
ALTER TABLE scopeflow.payments ADD COLUMN IF NOT EXISTS expires_at text;
ALTER TABLE scopeflow.payments ADD COLUMN IF NOT EXISTS session_url text;
ALTER TABLE scopeflow.payments ADD COLUMN IF NOT EXISTS open_version text;
ALTER TABLE scopeflow.payments ADD COLUMN IF NOT EXISTS return_ref text;
ALTER TABLE scopeflow.payments ADD COLUMN IF NOT EXISTS received_minor bigint;
ALTER TABLE scopeflow.payments ADD COLUMN IF NOT EXISTS outcome text;
ALTER TABLE scopeflow.payments ADD COLUMN IF NOT EXISTS excess_minor bigint;
ALTER TABLE scopeflow.payments ADD COLUMN IF NOT EXISTS manual_review text;
CREATE INDEX IF NOT EXISTS idx_payments_open ON scopeflow.payments(status, created DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_payments_return ON scopeflow.payments(return_ref);

-- Durable webhook inbox (M21): every verified event is stored before the provider gets a 2xx;
-- the reconcile job re-processes anything not yet processed.
CREATE TABLE IF NOT EXISTS scopeflow.payment_events (
  id text PRIMARY KEY,
  provider text NOT NULL,
  event_id text NOT NULL,
  account_id text,
  payload text NOT NULL,
  received text NOT NULL,
  processed_at text,
  attempts integer NOT NULL DEFAULT 0,
  last_error text,
  CONSTRAINT idx_payment_events_unique UNIQUE (provider, event_id)
);
CREATE INDEX IF NOT EXISTS idx_payment_events_open ON scopeflow.payment_events(received) WHERE processed_at IS NULL;

-- Refunds are reserved here first (H9/H14), inside the project lock, then issued at the provider
-- with an idempotency key, then finalised on the ledger. A crash leaves a row reconcile resolves.
CREATE TABLE IF NOT EXISTS scopeflow.refunds_pending (
  id text PRIMARY KEY,
  project_id text NOT NULL REFERENCES scopeflow.projects(id) ON DELETE CASCADE,
  request_id text NOT NULL,
  payment_seq integer NOT NULL,
  amount_minor bigint NOT NULL CHECK (amount_minor > 0),
  currency text NOT NULL,
  provider text NOT NULL,
  account_id text,
  payment_id text NOT NULL,
  idem_key text NOT NULL,
  note text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'issued', 'recorded', 'failed')),
  provider_refund_id text,
  ledger_seq integer,
  error text,
  created text NOT NULL,
  updated text NOT NULL,
  CONSTRAINT idx_refunds_pending_request UNIQUE (project_id, request_id)
);
CREATE INDEX IF NOT EXISTS idx_refunds_pending_open ON scopeflow.refunds_pending(status) WHERE status IN ('pending', 'issued');

-- Things the owner must look at: money captured that the record could not take (H6), short or
-- excess captures (M20, H8), refunds issued but not yet recorded (H14), stale orders (L4).
CREATE TABLE IF NOT EXISTS scopeflow.payment_alerts (
  id text PRIMARY KEY,
  project_id text REFERENCES scopeflow.projects(id) ON DELETE CASCADE,
  owner text,
  kind text NOT NULL,
  dedupe text,
  detail text NOT NULL DEFAULT '{}',
  created text NOT NULL,
  resolved_at text
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_payment_alerts_dedupe ON scopeflow.payment_alerts(dedupe) WHERE dedupe IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_payment_alerts_owner ON scopeflow.payment_alerts(owner, resolved_at);

-- "I've paid" claims from the client page (UPI / bank transfer with a UTR). The owner confirms
-- one, which appends a payment_received entry; nothing counts until then.
CREATE TABLE IF NOT EXISTS scopeflow.payment_claims (
  id text PRIMARY KEY,
  project_id text NOT NULL REFERENCES scopeflow.projects(id) ON DELETE CASCADE,
  version integer NOT NULL,
  purpose text NOT NULL CHECK (purpose IN ('deposit', 'invoice', 'balance')),
  invoice_seq integer,
  amount_minor bigint NOT NULL CHECK (amount_minor > 0),
  currency text NOT NULL,
  method text NOT NULL CHECK (method IN ('upi', 'bank_transfer')),
  utr text NOT NULL,
  payer_name text NOT NULL DEFAULT '',
  note text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed', 'rejected')),
  created text NOT NULL,
  decided_at text,
  ledger_seq integer,
  CONSTRAINT idx_payment_claims_utr UNIQUE (project_id, utr)
);
CREATE INDEX IF NOT EXISTS idx_payment_claims_status ON scopeflow.payment_claims(project_id, status);

-- Named cursors for batch jobs (L4: newest-first reconciliation that resumes where it stopped).
CREATE TABLE IF NOT EXISTS scopeflow.payment_cursors (
  name text PRIMARY KEY,
  value text,
  updated text NOT NULL
);

REVOKE ALL ON ALL TABLES IN SCHEMA scopeflow FROM PUBLIC;
