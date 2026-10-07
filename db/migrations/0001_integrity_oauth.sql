-- SF-04: make decided versions and ledger entries immutable at the database level,
-- and store server signatures (Ed25519) over each decision anchor and ledger hash.
ALTER TABLE scopeflow.versions ADD COLUMN IF NOT EXISTS signature text;
ALTER TABLE scopeflow.versions ADD COLUMN IF NOT EXISTS decision_context text;
ALTER TABLE scopeflow.ledger_entries ADD COLUMN IF NOT EXISTS signature text;
ALTER TABLE scopeflow.ledger_entries ADD COLUMN IF NOT EXISTS context text;

CREATE OR REPLACE FUNCTION scopeflow.deletion_allowed() RETURNS boolean
LANGUAGE sql STABLE AS $$ SELECT coalesce(current_setting('scopeflow.allow_delete', true), '') = 'on' $$;

CREATE OR REPLACE FUNCTION scopeflow.guard_versions() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF scopeflow.deletion_allowed() THEN RETURN OLD; END IF;
    RAISE EXCEPTION 'scopeflow: versions are immutable and cannot be deleted' USING ERRCODE = 'P0001';
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.project_id IS DISTINCT FROM OLD.project_id
     OR NEW.version IS DISTINCT FROM OLD.version OR NEW.content IS DISTINCT FROM OLD.content
     OR NEW.created IS DISTINCT FROM OLD.created THEN
    RAISE EXCEPTION 'scopeflow: version content is immutable' USING ERRCODE = 'P0001';
  END IF;
  IF OLD.status <> 'pending' AND (NEW.status IS DISTINCT FROM OLD.status OR NEW.signer IS DISTINCT FROM OLD.signer
     OR NEW.comment IS DISTINCT FROM OLD.comment OR NEW.decided IS DISTINCT FROM OLD.decided
     OR NEW.signature IS DISTINCT FROM OLD.signature OR NEW.decision_context IS DISTINCT FROM OLD.decision_context) THEN
    RAISE EXCEPTION 'scopeflow: a recorded decision is immutable' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION scopeflow.guard_ledger() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' AND scopeflow.deletion_allowed() THEN RETURN OLD; END IF;
  RAISE EXCEPTION 'scopeflow: ledger entries are append-only' USING ERRCODE = 'P0001';
END $$;

CREATE OR REPLACE FUNCTION scopeflow.guard_projects() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF scopeflow.deletion_allowed() THEN RETURN OLD; END IF;
    RAISE EXCEPTION 'scopeflow: projects cannot be deleted outside account deletion' USING ERRCODE = 'P0001';
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.owner IS DISTINCT FROM OLD.owner OR NEW.created IS DISTINCT FROM OLD.created
     OR NEW.latest < OLD.latest THEN
    RAISE EXCEPTION 'scopeflow: project identity is immutable' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION scopeflow.guard_truncate() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'scopeflow: % cannot be truncated', TG_TABLE_NAME USING ERRCODE = 'P0001';
END $$;

DROP TRIGGER IF EXISTS versions_immutable ON scopeflow.versions;
CREATE TRIGGER versions_immutable BEFORE UPDATE OR DELETE ON scopeflow.versions FOR EACH ROW EXECUTE FUNCTION scopeflow.guard_versions();
DROP TRIGGER IF EXISTS ledger_append_only ON scopeflow.ledger_entries;
CREATE TRIGGER ledger_append_only BEFORE UPDATE OR DELETE ON scopeflow.ledger_entries FOR EACH ROW EXECUTE FUNCTION scopeflow.guard_ledger();
DROP TRIGGER IF EXISTS projects_guard ON scopeflow.projects;
CREATE TRIGGER projects_guard BEFORE UPDATE OR DELETE ON scopeflow.projects FOR EACH ROW EXECUTE FUNCTION scopeflow.guard_projects();
DROP TRIGGER IF EXISTS versions_no_truncate ON scopeflow.versions;
CREATE TRIGGER versions_no_truncate BEFORE TRUNCATE ON scopeflow.versions FOR EACH STATEMENT EXECUTE FUNCTION scopeflow.guard_truncate();
DROP TRIGGER IF EXISTS ledger_no_truncate ON scopeflow.ledger_entries;
CREATE TRIGGER ledger_no_truncate BEFORE TRUNCATE ON scopeflow.ledger_entries FOR EACH STATEMENT EXECUTE FUNCTION scopeflow.guard_truncate();
DROP TRIGGER IF EXISTS projects_no_truncate ON scopeflow.projects;
CREATE TRIGGER projects_no_truncate BEFORE TRUNCATE ON scopeflow.projects FOR EACH STATEMENT EXECUTE FUNCTION scopeflow.guard_truncate();

-- SF-01: OAuth 2.1 authorization server for the MCP connector.
CREATE TABLE IF NOT EXISTS scopeflow.oauth_clients (
  id text PRIMARY KEY, secret_hash text, name text NOT NULL, redirect_uris text NOT NULL,
  auth_method text NOT NULL, created text NOT NULL
);
CREATE TABLE IF NOT EXISTS scopeflow.oauth_codes (
  hash text PRIMARY KEY, client_id text NOT NULL, owner text NOT NULL, redirect_uri text NOT NULL,
  challenge text NOT NULL, scope text NOT NULL, resource text NOT NULL, expires text NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_oauth_codes_owner ON scopeflow.oauth_codes(owner);
CREATE TABLE IF NOT EXISTS scopeflow.oauth_tokens (
  hash text PRIMARY KEY, kind text NOT NULL, client_id text NOT NULL, owner text NOT NULL,
  scope text NOT NULL, resource text NOT NULL, expires text NOT NULL, created text NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_oauth_tokens_owner ON scopeflow.oauth_tokens(owner);
REVOKE ALL ON ALL TABLES IN SCHEMA scopeflow FROM PUBLIC;
