-- Trust features: review-link expiry, SMS one-time codes, countersignatures and RFC 3161 timestamps.

-- Review-link expiry (undecided versions only). NULL = links never expire. link_issued is when the
-- current link was handed out (a new version or a replaced link); NULL means the version's own date.
ALTER TABLE scopeflow.projects ADD COLUMN IF NOT EXISTS link_expiry_days integer CHECK (link_expiry_days IS NULL OR link_expiry_days BETWEEN 1 AND 365);
ALTER TABLE scopeflow.projects ADD COLUMN IF NOT EXISTS link_issued text;

-- One-time codes by SMS or WhatsApp as well as email. client_phone is E.164 (+919876543210).
-- review_otps.email holds the destination for every channel; channel says which one it is.
ALTER TABLE scopeflow.projects ADD COLUMN IF NOT EXISTS client_phone text;
ALTER TABLE scopeflow.projects ADD COLUMN IF NOT EXISTS otp_channel text NOT NULL DEFAULT 'email' CHECK (otp_channel IN ('email', 'sms', 'whatsapp'));
ALTER TABLE scopeflow.review_otps ADD COLUMN IF NOT EXISTS channel text NOT NULL DEFAULT 'email';

-- Countersignatures: roles (JSON [{id, role}]) that must also sign an approved version, such as a
-- finance approver after the project lead. Each signature is Ed25519 over the version's anchor and
-- the signer's details, stored once and never changed (only full account deletion removes it).
ALTER TABLE scopeflow.projects ADD COLUMN IF NOT EXISTS cosigners text;
CREATE TABLE IF NOT EXISTS scopeflow.version_cosigns (
  id text PRIMARY KEY,
  project_id text NOT NULL REFERENCES scopeflow.projects(id),
  version integer NOT NULL,
  cosigner_id text NOT NULL,
  role text NOT NULL,
  signer text NOT NULL,
  signed text NOT NULL,
  signature text,
  context text,
  UNIQUE (project_id, version, cosigner_id)
);
CREATE INDEX IF NOT EXISTS idx_version_cosigns_project ON scopeflow.version_cosigns (project_id, version);
CREATE OR REPLACE FUNCTION scopeflow.guard_cosigns() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' AND scopeflow.deletion_allowed() AND coalesce(current_setting('scopeflow.account_delete', true), '') = 'on' THEN RETURN OLD; END IF;
  RAISE EXCEPTION 'scopeflow: countersignatures are immutable' USING ERRCODE = 'P0001';
END $$;
DROP TRIGGER IF EXISTS version_cosigns_immutable ON scopeflow.version_cosigns;
CREATE TRIGGER version_cosigns_immutable BEFORE UPDATE OR DELETE ON scopeflow.version_cosigns FOR EACH ROW EXECUTE FUNCTION scopeflow.guard_cosigns();

-- RFC 3161 timestamp tokens from an external timestamp authority (SCOPEFLOW_TSA_URL) over a record
-- fingerprint: a decision's anchor, a countersignature or a ledger head. token is the DER
-- TimeStampToken (base64), verifiable offline with `openssl ts -verify`.
CREATE TABLE IF NOT EXISTS scopeflow.timestamps (
  id text PRIMARY KEY,
  project_id text NOT NULL REFERENCES scopeflow.projects(id),
  version integer NOT NULL,
  subject text NOT NULL,
  digest text NOT NULL,
  tsa text NOT NULL,
  token text NOT NULL,
  gen_time text NOT NULL,
  created text NOT NULL,
  UNIQUE (project_id, subject, digest)
);
CREATE INDEX IF NOT EXISTS idx_timestamps_project ON scopeflow.timestamps (project_id, version);
CREATE OR REPLACE FUNCTION scopeflow.guard_timestamps() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' AND scopeflow.deletion_allowed() AND coalesce(current_setting('scopeflow.account_delete', true), '') = 'on' THEN RETURN OLD; END IF;
  RAISE EXCEPTION 'scopeflow: timestamps are immutable' USING ERRCODE = 'P0001';
END $$;
DROP TRIGGER IF EXISTS timestamps_immutable ON scopeflow.timestamps;
CREATE TRIGGER timestamps_immutable BEFORE UPDATE OR DELETE ON scopeflow.timestamps FOR EACH ROW EXECUTE FUNCTION scopeflow.guard_timestamps();

REVOKE ALL ON ALL TABLES IN SCHEMA scopeflow FROM PUBLIC;
