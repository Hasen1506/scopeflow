-- PR F: deposit on signature (Razorpay scaffold). One row per provider order. Only the verified
-- webhook moves a row to 'paid' (idempotently) and appends a 'payment' entry to the ledger.
CREATE TABLE IF NOT EXISTS scopeflow.payments (
  id text PRIMARY KEY,
  project_id text NOT NULL REFERENCES scopeflow.projects(id),
  version integer NOT NULL,
  provider text NOT NULL,
  order_id text NOT NULL,
  amount_minor bigint NOT NULL,
  currency text NOT NULL,
  status text NOT NULL DEFAULT 'created',
  payment_id text,
  event_id text,
  created text NOT NULL,
  paid_at text,
  CONSTRAINT idx_payments_order UNIQUE(provider, order_id)
);
CREATE INDEX IF NOT EXISTS idx_payments_project ON scopeflow.payments(project_id, version);
REVOKE ALL ON ALL TABLES IN SCHEMA scopeflow FROM PUBLIC;
