-- WS-08: workspace modes, onboarding fields, per-account plans and ScopeFlow's own billing,
-- account-deletion tombstones, audit events and the 180-day default retention.
-- Additive and idempotent (IF NOT EXISTS / CREATE OR REPLACE / DROP TRIGGER IF EXISTS).

-- Workspace mode (plan §7) per account, with an optional per-project override. A mode changes
-- defaults, ordering and wording only; NULL on a project means "the account's mode".
ALTER TABLE scopeflow.account_settings ADD COLUMN IF NOT EXISTS mode text NOT NULL DEFAULT 'freelancer';
ALTER TABLE scopeflow.account_settings DROP CONSTRAINT IF EXISTS account_settings_mode_check;
ALTER TABLE scopeflow.account_settings ADD CONSTRAINT account_settings_mode_check CHECK (mode IN ('freelancer', 'agency', 'consumer', 'enterprise'));
-- Onboarding: the account's country, its default IANA time zone and when onboarding finished.
ALTER TABLE scopeflow.account_settings ADD COLUMN IF NOT EXISTS country text;
ALTER TABLE scopeflow.account_settings ADD COLUMN IF NOT EXISTS timezone text;
ALTER TABLE scopeflow.account_settings ADD COLUMN IF NOT EXISTS onboarded text;
ALTER TABLE scopeflow.projects ADD COLUMN IF NOT EXISTS mode text CHECK (mode IS NULL OR mode IN ('freelancer', 'agency', 'consumer', 'enterprise'));

-- M32: default retention for client IP/user agent is 180 days (founder decision). Accounts that
-- never chose a period get 180 explicitly; the server default (SCOPEFLOW_CONTEXT_RETENTION_DAYS,
-- else 180) covers accounts without a settings row.
UPDATE scopeflow.account_settings SET context_retention_days = 180 WHERE context_retention_days IS NULL;

-- Business profile: UPI VPA and Udyam (MSME) registration. GSTIN stays in tax_id (validated).
ALTER TABLE scopeflow.business_profiles ADD COLUMN IF NOT EXISTS upi_vpa text;
ALTER TABLE scopeflow.business_profiles ADD COLUMN IF NOT EXISTS udyam_number text;
ALTER TABLE scopeflow.business_profiles ADD COLUMN IF NOT EXISTS udyam_date text;
ALTER TABLE scopeflow.business_profiles ADD COLUMN IF NOT EXISTS udyam_category text CHECK (udyam_category IS NULL OR udyam_category IN ('micro', 'small', 'medium'));

-- M13: per-account plans. One row per owner; no row = the server default plan (SCOPEFLOW_PLAN).
-- status: active | halted (payment failed; grace_until keeps the plan for 7 days) | cancelled
-- (kept until period_end) | expired. provider ids identify the subscription at Razorpay/Stripe.
CREATE TABLE IF NOT EXISTS scopeflow.accounts_plans (
  owner text PRIMARY KEY,
  plan text NOT NULL,
  status text NOT NULL CHECK (status IN ('active', 'halted', 'cancelled', 'expired', 'pending')),
  period_end text,
  grace_until text,
  provider text CHECK (provider IS NULL OR provider IN ('razorpay', 'stripe', 'local')),
  provider_customer text,
  provider_subscription text,
  interval text CHECK (interval IS NULL OR interval IN ('month', 'year')),
  updated text NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_accounts_plans_subscription ON scopeflow.accounts_plans(provider, provider_subscription) WHERE provider_subscription IS NOT NULL;
-- Webhook events already applied (idempotency) and ScopeFlow's own GST invoices to subscribers.
CREATE TABLE IF NOT EXISTS scopeflow.billing_events (
  provider text NOT NULL,
  event_id text NOT NULL,
  owner text,
  kind text NOT NULL,
  received text NOT NULL,
  PRIMARY KEY (provider, event_id)
);
CREATE TABLE IF NOT EXISTS scopeflow.billing_invoices (
  id text PRIMARY KEY,
  owner text NOT NULL,
  seq integer NOT NULL UNIQUE,
  number text NOT NULL UNIQUE,
  provider text NOT NULL,
  provider_payment text,
  amount_minor bigint NOT NULL CHECK (amount_minor > 0),
  currency text NOT NULL,
  issued text NOT NULL,
  content text NOT NULL,
  UNIQUE (provider, provider_payment)
);
CREATE INDEX IF NOT EXISTS idx_billing_invoices_owner ON scopeflow.billing_invoices(owner);

-- H10: account deletion keeps the client's record. owner_deleted marks a tombstoned project
-- (the owner closed their account); retain_until is when the retention job may purge it.
ALTER TABLE scopeflow.projects ADD COLUMN IF NOT EXISTS owner_deleted text;
ALTER TABLE scopeflow.projects ADD COLUMN IF NOT EXISTS retain_until text;
CREATE INDEX IF NOT EXISTS idx_projects_tombstoned ON scopeflow.projects(retain_until) WHERE owner_deleted IS NOT NULL;
CREATE TABLE IF NOT EXISTS scopeflow.owner_tombstones (
  owner text PRIMARY KEY,
  deleted text NOT NULL,
  retain_until text NOT NULL,
  projects_kept integer NOT NULL,
  login_deleted boolean NOT NULL DEFAULT false
);

-- A tombstoned project is read-only: no new versions, decisions, ledger entries, cosigns,
-- payments or invoices, and no project changes, except inside the tombstone transaction itself
-- (scopeflow.tombstone=on) or a retention redaction (scopeflow.redact=on, versions/ledger only;
-- the existing guards still restrict what a redaction may change).
CREATE OR REPLACE FUNCTION scopeflow.tombstoned(project text) RETURNS boolean
LANGUAGE sql STABLE AS $$ SELECT EXISTS (SELECT 1 FROM scopeflow.projects WHERE id = project AND owner_deleted IS NOT NULL) $$;
CREATE OR REPLACE FUNCTION scopeflow.guard_tombstone_project() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.owner_deleted IS NOT NULL AND coalesce(current_setting('scopeflow.tombstone', true), '') <> 'on' THEN
    RAISE EXCEPTION 'scopeflow: the creator closed this account; the project is read-only' USING ERRCODE = 'P0001';
  END IF;
  IF OLD.owner_deleted IS NOT NULL AND NEW.owner_deleted IS NULL THEN
    RAISE EXCEPTION 'scopeflow: a closed account cannot be reopened' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS projects_tombstone_guard ON scopeflow.projects;
CREATE TRIGGER projects_tombstone_guard BEFORE UPDATE ON scopeflow.projects FOR EACH ROW EXECUTE FUNCTION scopeflow.guard_tombstone_project();
CREATE OR REPLACE FUNCTION scopeflow.guard_tombstone_child() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND coalesce(current_setting('scopeflow.redact', true), '') = 'on' THEN RETURN NEW; END IF;
  IF scopeflow.tombstoned(NEW.project_id) AND coalesce(current_setting('scopeflow.tombstone', true), '') <> 'on' THEN
    RAISE EXCEPTION 'scopeflow: the creator closed this account; the project is read-only' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS versions_tombstone_guard ON scopeflow.versions;
CREATE TRIGGER versions_tombstone_guard BEFORE INSERT OR UPDATE ON scopeflow.versions FOR EACH ROW EXECUTE FUNCTION scopeflow.guard_tombstone_child();
DROP TRIGGER IF EXISTS ledger_tombstone_guard ON scopeflow.ledger_entries;
CREATE TRIGGER ledger_tombstone_guard BEFORE INSERT ON scopeflow.ledger_entries FOR EACH ROW EXECUTE FUNCTION scopeflow.guard_tombstone_child();
DROP TRIGGER IF EXISTS cosigns_tombstone_guard ON scopeflow.version_cosigns;
CREATE TRIGGER cosigns_tombstone_guard BEFORE INSERT ON scopeflow.version_cosigns FOR EACH ROW EXECUTE FUNCTION scopeflow.guard_tombstone_child();
DROP TRIGGER IF EXISTS payments_tombstone_guard ON scopeflow.payments;
CREATE TRIGGER payments_tombstone_guard BEFORE INSERT ON scopeflow.payments FOR EACH ROW EXECUTE FUNCTION scopeflow.guard_tombstone_child();
DROP TRIGGER IF EXISTS invoices_tombstone_guard ON scopeflow.invoices;
CREATE TRIGGER invoices_tombstone_guard BEFORE INSERT ON scopeflow.invoices FOR EACH ROW EXECUTE FUNCTION scopeflow.guard_tombstone_child();

-- SF-25: account-level admin events (mode, retention, plan, export, deletion) for the audit
-- export. Append-only; removed only by account deletion.
CREATE TABLE IF NOT EXISTS scopeflow.audit_events (
  id text PRIMARY KEY,
  owner text NOT NULL,
  kind text NOT NULL,
  detail text NOT NULL,
  actor text NOT NULL,
  created text NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_events_owner ON scopeflow.audit_events(owner, created);
CREATE OR REPLACE FUNCTION scopeflow.guard_audit_events() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' AND scopeflow.deletion_allowed() AND coalesce(current_setting('scopeflow.account_delete', true), '') = 'on' THEN RETURN OLD; END IF;
  RAISE EXCEPTION 'scopeflow: audit events are append-only' USING ERRCODE = 'P0001';
END $$;
DROP TRIGGER IF EXISTS audit_events_append_only ON scopeflow.audit_events;
CREATE TRIGGER audit_events_append_only BEFORE UPDATE OR DELETE ON scopeflow.audit_events FOR EACH ROW EXECUTE FUNCTION scopeflow.guard_audit_events();

REVOKE ALL ON ALL TABLES IN SCHEMA scopeflow FROM PUBLIC;
