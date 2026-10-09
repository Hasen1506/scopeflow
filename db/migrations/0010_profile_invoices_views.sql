-- Business profile, numbered invoices and review-link views.
--
-- business_profiles: one row per owner. The seller details printed on invoices (name, address,
-- tax ID, how to pay), defaults pre-filled into new drafts (currency, tax, deposit, payment terms),
-- auto_remind_days (NULL = off) for the daily reminder job, and next_invoice, the owner's invoice
-- counter. Numbers are taken and the invoice is inserted in one statement, so they have no gaps.
CREATE TABLE IF NOT EXISTS scopeflow.business_profiles (
  owner text PRIMARY KEY,
  business_name text,
  business_address text,
  tax_id text,
  payment_details text,
  invoice_prefix text,
  default_currency text,
  default_tax_label text,
  default_tax_pct double precision CHECK (default_tax_pct IS NULL OR default_tax_pct BETWEEN 0 AND 100),
  default_deposit_pct double precision CHECK (default_deposit_pct IS NULL OR default_deposit_pct BETWEEN 0 AND 100),
  default_payment_terms text,
  auto_remind_days integer CHECK (auto_remind_days IS NULL OR auto_remind_days BETWEEN 1 AND 60),
  next_invoice integer NOT NULL DEFAULT 1,
  updated text NOT NULL
);

-- Issued invoices. content is the full JSON snapshot that the PDF is rendered from (seller,
-- client, lines, tax split, dates), so an invoice never changes after issue, even when the
-- profile does. Rows are immutable; only full account deletion removes them.
CREATE TABLE IF NOT EXISTS scopeflow.invoices (
  id text PRIMARY KEY,
  owner text NOT NULL,
  project_id text NOT NULL REFERENCES scopeflow.projects(id),
  seq integer NOT NULL,
  number text NOT NULL,
  version integer NOT NULL,
  amount double precision NOT NULL CHECK (amount > 0),
  currency text NOT NULL,
  issued text NOT NULL,
  request_id text,
  content text NOT NULL,
  UNIQUE (owner, seq),
  UNIQUE (owner, request_id)
);
CREATE INDEX IF NOT EXISTS idx_invoices_project ON scopeflow.invoices (project_id);

CREATE OR REPLACE FUNCTION scopeflow.guard_invoices() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' AND scopeflow.deletion_allowed() AND coalesce(current_setting('scopeflow.account_delete', true), '') = 'on' THEN RETURN OLD; END IF;
  RAISE EXCEPTION 'scopeflow: invoices are immutable once issued' USING ERRCODE = 'P0001';
END $$;
DROP TRIGGER IF EXISTS invoices_immutable ON scopeflow.invoices;
CREATE TRIGGER invoices_immutable BEFORE UPDATE OR DELETE ON scopeflow.invoices FOR EACH ROW EXECUTE FUNCTION scopeflow.guard_invoices();

-- When a review link was opened by someone other than its owner: first and last time, and how
-- often. Owner-private; never shown to the client and not part of any signed record.
CREATE TABLE IF NOT EXISTS scopeflow.review_views (
  project_id text NOT NULL,
  version integer NOT NULL,
  first_viewed text NOT NULL,
  last_viewed text NOT NULL,
  views integer NOT NULL DEFAULT 1,
  PRIMARY KEY (project_id, version)
);

REVOKE ALL ON ALL TABLES IN SCHEMA scopeflow FROM PUBLIC;
