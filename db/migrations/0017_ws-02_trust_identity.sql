-- WS-02: evidence, signing and client identity. Additive and idempotent.
--
-- H5   version_links.link_issued: review-link expiry is per version (copied from the project once).
-- H2   version_links.first_sent: when this version's link was first handed to the client (an email
--      send, a copied or shared link, or a decision on it). Only sent, opened or decided versions are
--      ever shown to a token holder as "previous" or as a diff base.
-- M17  version_links.cosigners: the countersigning roles frozen into the version at first send.
-- H1   cosign_invites: one link token per countersigning role, with that role's own address.
-- H4   version_link_aliases: a rotated link of a decided version stays a read-only alias.
-- M14  review_otps.action/target/consumed: one-time codes bound to an action and used once.
-- M15  otp_spend: per-owner metering of codes sent (cost and abuse limits).
-- C5   contact_history: signed record of every change to a locked client contact;
--      projects.contact_since: the date the current client contact has been on file.
-- SF-15 esign_records: Aadhaar eSign (provider) requests and their signed PDFs.
-- QA-01 receipt_cache: rendered receipt PDFs by record hash.
-- M28  idempotency_keys: same definition as WS-10's 0016 (CREATE IF NOT EXISTS), so the decision
--      route can use lib/idempotency.ts before or after WS-10 merges.
-- H10  projects.owner_deleted / retain_until: same definitions as WS-08's 0022 (ADD COLUMN IF NOT EXISTS), so owner
--      routes can already filter tombstoned projects.

ALTER TABLE scopeflow.projects ADD COLUMN IF NOT EXISTS contact_since text;
ALTER TABLE scopeflow.projects ADD COLUMN IF NOT EXISTS owner_deleted text;
ALTER TABLE scopeflow.projects ADD COLUMN IF NOT EXISTS retain_until text;

-- Per-version link and identity state. A side table rather than new versions columns, so every
-- `SELECT v.*` (exports, owner history, their goldens) stays byte-identical.
CREATE TABLE IF NOT EXISTS scopeflow.version_links (
  project_id text NOT NULL REFERENCES scopeflow.projects(id) ON DELETE CASCADE,
  version integer NOT NULL,
  link_issued text,
  first_sent text,
  sent_via text,
  cosigners text,
  PRIMARY KEY (project_id, version)
);

-- H5: the project-level link_issued belonged to the latest version.
INSERT INTO scopeflow.version_links (project_id, version, link_issued)
SELECT p.id, p.latest, p.link_issued FROM scopeflow.projects p
 WHERE p.link_issued IS NOT NULL AND EXISTS (SELECT 1 FROM scopeflow.versions v WHERE v.project_id = p.id AND v.version = p.latest)
ON CONFLICT (project_id, version) DO NOTHING;

-- H2: decided versions were sent; so was the version last emailed through Scopeflow.
INSERT INTO scopeflow.version_links (project_id, version, first_sent, sent_via)
SELECT v.project_id, v.version, coalesce(v.decided, v.created), 'decision' FROM scopeflow.versions v WHERE v.status <> 'pending'
ON CONFLICT (project_id, version) DO UPDATE SET first_sent = coalesce(scopeflow.version_links.first_sent, EXCLUDED.first_sent), sent_via = coalesce(scopeflow.version_links.sent_via, EXCLUDED.sent_via);
INSERT INTO scopeflow.version_links (project_id, version, first_sent, sent_via)
SELECT p.id, p.sent_version, p.last_sent, 'email' FROM scopeflow.projects p
 WHERE p.last_sent IS NOT NULL AND p.sent_version IS NOT NULL AND EXISTS (SELECT 1 FROM scopeflow.versions v WHERE v.project_id = p.id AND v.version = p.sent_version)
ON CONFLICT (project_id, version) DO UPDATE SET first_sent = coalesce(scopeflow.version_links.first_sent, EXCLUDED.first_sent), sent_via = coalesce(scopeflow.version_links.sent_via, EXCLUDED.sent_via);

-- M17: versions already sent keep the roles the project lists today ('[]' when none).
UPDATE scopeflow.version_links l SET cosigners = coalesce(p.cosigners, '[]')
  FROM scopeflow.projects p
 WHERE p.id = l.project_id AND l.first_sent IS NOT NULL AND l.cosigners IS NULL;

-- C5: "on file since" starts at the project's creation for contacts that exist today.
UPDATE scopeflow.projects SET contact_since = created
 WHERE contact_since IS NULL AND (client_email IS NOT NULL OR client_phone IS NOT NULL);

-- An email send through Scopeflow (projects.last_sent / sent_version, written by the send route)
-- marks that version as sent.
CREATE OR REPLACE FUNCTION scopeflow.mark_version_sent() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.last_sent IS NOT NULL AND NEW.sent_version IS NOT NULL
     AND (OLD.last_sent IS DISTINCT FROM NEW.last_sent OR OLD.sent_version IS DISTINCT FROM NEW.sent_version) THEN
    INSERT INTO scopeflow.version_links (project_id, version, first_sent, sent_via) VALUES (NEW.id, NEW.sent_version, NEW.last_sent, 'email')
    ON CONFLICT (project_id, version) DO UPDATE SET first_sent = coalesce(scopeflow.version_links.first_sent, EXCLUDED.first_sent), sent_via = coalesce(scopeflow.version_links.sent_via, EXCLUDED.sent_via);
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS projects_mark_sent ON scopeflow.projects;
CREATE TRIGGER projects_mark_sent AFTER UPDATE OF last_sent, sent_version ON scopeflow.projects FOR EACH ROW EXECUTE FUNCTION scopeflow.mark_version_sent();

-- first_sent and the frozen roles never change once set.
CREATE OR REPLACE FUNCTION scopeflow.guard_version_links() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF scopeflow.deletion_allowed() THEN RETURN OLD; END IF;
    RAISE EXCEPTION 'scopeflow: version link records cannot be deleted' USING ERRCODE = 'P0001';
  END IF;
  IF OLD.first_sent IS NOT NULL AND NEW.first_sent IS DISTINCT FROM OLD.first_sent THEN
    RAISE EXCEPTION 'scopeflow: first_sent is immutable' USING ERRCODE = 'P0001';
  END IF;
  IF OLD.cosigners IS NOT NULL AND NEW.cosigners IS DISTINCT FROM OLD.cosigners THEN
    RAISE EXCEPTION 'scopeflow: countersigning roles are frozen into the version' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS version_links_guard ON scopeflow.version_links;
CREATE TRIGGER version_links_guard BEFORE UPDATE OR DELETE ON scopeflow.version_links FOR EACH ROW EXECUTE FUNCTION scopeflow.guard_version_links();

-- H1: per-role countersigning links. The token is a 256-bit capability like a review token.
CREATE TABLE IF NOT EXISTS scopeflow.cosign_invites (
  id text PRIMARY KEY,
  project_id text NOT NULL REFERENCES scopeflow.projects(id) ON DELETE CASCADE,
  version integer NOT NULL,
  cosigner_id text NOT NULL,
  role text NOT NULL,
  name text,
  email text,
  phone text,
  token text NOT NULL UNIQUE,
  created text NOT NULL,
  UNIQUE (project_id, version, cosigner_id)
);
CREATE INDEX IF NOT EXISTS idx_cosign_invites_project ON scopeflow.cosign_invites (project_id, version);

-- H4: earlier tokens of a decided version keep working read-only.
CREATE TABLE IF NOT EXISTS scopeflow.version_link_aliases (
  token text PRIMARY KEY,
  project_id text NOT NULL REFERENCES scopeflow.projects(id) ON DELETE CASCADE,
  version integer NOT NULL,
  reason text NOT NULL,
  created text NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_version_link_aliases_project ON scopeflow.version_link_aliases (project_id, version);

-- M14: codes are bound to an action (decision, change_order, cosign) and a target (CO seq or
-- countersigning role), and a verified session is consumed by the first record it backs.
ALTER TABLE scopeflow.review_otps ADD COLUMN IF NOT EXISTS action text NOT NULL DEFAULT 'decision';
ALTER TABLE scopeflow.review_otps ADD COLUMN IF NOT EXISTS target text;
ALTER TABLE scopeflow.review_otps ADD COLUMN IF NOT EXISTS consumed text;
CREATE INDEX IF NOT EXISTS idx_review_otps_destination ON scopeflow.review_otps (email, created);

-- M15: what each owner's codes cost (units: 1 email, 1 WhatsApp, 5 SMS). Owner-private metering.
CREATE TABLE IF NOT EXISTS scopeflow.otp_spend (
  id text PRIMARY KEY,
  owner text NOT NULL,
  project_id text NOT NULL,
  version_id text NOT NULL,
  channel text NOT NULL,
  destination_hash text NOT NULL,
  units integer NOT NULL,
  day text NOT NULL,
  created text NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_otp_spend_owner_day ON scopeflow.otp_spend (owner, day);

-- C5: each change of a locked client contact, signed with the record key and never changed.
CREATE TABLE IF NOT EXISTS scopeflow.contact_history (
  id text PRIMARY KEY,
  project_id text NOT NULL REFERENCES scopeflow.projects(id) ON DELETE CASCADE,
  field text NOT NULL CHECK (field IN ('email', 'phone')),
  from_masked text,
  to_masked text,
  reason text NOT NULL,
  at text NOT NULL,
  signature text,
  notice text
);
CREATE INDEX IF NOT EXISTS idx_contact_history_project ON scopeflow.contact_history (project_id, at);
CREATE OR REPLACE FUNCTION scopeflow.guard_contact_history() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' AND scopeflow.deletion_allowed() AND coalesce(current_setting('scopeflow.account_delete', true), '') = 'on' THEN RETURN OLD; END IF;
  RAISE EXCEPTION 'scopeflow: contact history is immutable' USING ERRCODE = 'P0001';
END $$;
DROP TRIGGER IF EXISTS contact_history_immutable ON scopeflow.contact_history;
CREATE TRIGGER contact_history_immutable BEFORE UPDATE OR DELETE ON scopeflow.contact_history FOR EACH ROW EXECUTE FUNCTION scopeflow.guard_contact_history();

-- SF-15: Aadhaar eSign through a provider (per-version opt-in). The signed PDF (base64) and the
-- provider's audit trail are attached once the provider calls back.
CREATE TABLE IF NOT EXISTS scopeflow.esign_records (
  id text PRIMARY KEY,
  project_id text NOT NULL REFERENCES scopeflow.projects(id) ON DELETE CASCADE,
  version integer NOT NULL,
  provider text NOT NULL,
  document_id text NOT NULL UNIQUE,
  status text NOT NULL CHECK (status IN ('requested', 'signed', 'failed')),
  signing_url text,
  signed_pdf text,
  signed_sha256 text,
  audit_trail text,
  signer_masked text,
  created text NOT NULL,
  completed text,
  UNIQUE (project_id, version)
);

-- QA-01: rendered receipt PDFs, keyed by the hash of everything that goes into them.
CREATE TABLE IF NOT EXISTS scopeflow.receipt_cache (
  key text PRIMARY KEY,
  project_id text NOT NULL REFERENCES scopeflow.projects(id) ON DELETE CASCADE,
  pdf text NOT NULL,
  created text NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_receipt_cache_project ON scopeflow.receipt_cache (project_id);

-- M28 (WS-10's definition, repeated so this branch works on its own).
CREATE TABLE IF NOT EXISTS scopeflow.idempotency_keys (
  scope text NOT NULL,
  key text NOT NULL,
  fingerprint text NOT NULL,
  status integer,
  body text,
  created text NOT NULL,
  PRIMARY KEY (scope, key)
);
CREATE INDEX IF NOT EXISTS idx_idempotency_created ON scopeflow.idempotency_keys (created);

REVOKE ALL ON ALL TABLES IN SCHEMA scopeflow FROM PUBLIC;
