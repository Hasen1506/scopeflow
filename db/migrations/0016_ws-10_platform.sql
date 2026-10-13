-- WS-10: platform security and operations (docs/ws-10.md).
-- Additive and idempotent. Runs as the migration (owner) role: DATABASE_MIGRATION_URL in production.
--
-- C7   runtime role scopeflow_app (no ownership, no TRUNCATE, no ALTER/DISABLE TRIGGER); the
--      set_config('scopeflow.allow_delete') bypass is honoured only for the table owner (that is,
--      inside SECURITY DEFINER functions such as delete_project_tombstone), never for the app role.
-- C7   daily signed ledger-head digests (head_digests) and the deletion audit log.
-- M23  OAuth token families (grants), code replay and refresh-token reuse detection.
-- M24  per-grant metadata for the connected-apps list.
-- M28  idempotency keys.   M31 cron_runs.   SF-14 analytics_events (no client PII).

-- ---------------------------------------------------------------------------------------------
-- C7: roles. The app role is a group role (NOLOGIN); the operator grants it to the login role used
-- in DATABASE_URL (docs/ws-10.md). Creating roles needs CREATEROLE; where the migration role lacks
-- it, the step is skipped with a notice and the operator runs it once by hand.
-- ---------------------------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'scopeflow_app') THEN
    CREATE ROLE scopeflow_app NOLOGIN;
  END IF;
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE 'scopeflow: cannot create role scopeflow_app (needs CREATEROLE); see docs/ws-10.md';
END $$;

-- The bypass of the immutability triggers now needs the table owner (or a superuser). The app role
-- can still set the setting, but it no longer has any effect for it.
CREATE OR REPLACE FUNCTION scopeflow.deletion_allowed() RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT coalesce(current_setting('scopeflow.allow_delete', true), '') = 'on'
     AND (current_user::text = (SELECT tableowner::text FROM pg_tables WHERE schemaname = 'scopeflow' AND tablename = 'versions')
          OR coalesce((SELECT rolsuper FROM pg_roles WHERE rolname = current_user), false))
$$;

-- Every deletion through the SECURITY DEFINER functions leaves a row here (also refusals).
CREATE TABLE IF NOT EXISTS scopeflow.deletion_audit (
  id text PRIMARY KEY,
  project_id text NOT NULL,
  owner text,
  actor text NOT NULL,
  db_role text NOT NULL,
  outcome text NOT NULL CHECK (outcome IN ('deleted', 'refused_decided', 'refused_ledger', 'refused_legal_hold', 'not_found')),
  versions_deleted integer NOT NULL DEFAULT 0,
  at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_deletion_audit_project ON scopeflow.deletion_audit (project_id);

CREATE OR REPLACE FUNCTION scopeflow.guard_audit() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'scopeflow: the deletion audit is append-only' USING ERRCODE = 'P0001';
END $$;
DROP TRIGGER IF EXISTS deletion_audit_append_only ON scopeflow.deletion_audit;
CREATE TRIGGER deletion_audit_append_only BEFORE UPDATE OR DELETE ON scopeflow.deletion_audit FOR EACH ROW EXECUTE FUNCTION scopeflow.guard_audit();
DROP TRIGGER IF EXISTS deletion_audit_no_truncate ON scopeflow.deletion_audit;
CREATE TRIGGER deletion_audit_no_truncate BEFORE TRUNCATE ON scopeflow.deletion_audit FOR EACH STATEMENT EXECUTE FUNCTION scopeflow.guard_truncate();

-- Deletes one project that holds no client evidence: no decided version, no ledger entry, no legal
-- hold (the same rule as lib/retention-sql.ts draftDeleteQueries). Anything else is refused. The
-- outcome is returned and written to deletion_audit either way. `want_owner` must own the project.
CREATE OR REPLACE FUNCTION scopeflow.delete_project_tombstone(target text, want_owner text, actor text DEFAULT 'app')
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, scopeflow AS $$
DECLARE
  p record;
  result text;
  removed integer := 0;
BEGIN
  SELECT id, owner, legal_hold INTO p FROM scopeflow.projects WHERE id = target FOR UPDATE;
  IF NOT FOUND OR p.owner IS DISTINCT FROM want_owner THEN
    result := 'not_found';
  ELSIF p.legal_hold THEN
    result := 'refused_legal_hold';
  ELSIF EXISTS (SELECT 1 FROM scopeflow.versions WHERE project_id = target AND status <> 'pending') THEN
    result := 'refused_decided';
  ELSIF EXISTS (SELECT 1 FROM scopeflow.ledger_entries WHERE project_id = target) THEN
    result := 'refused_ledger';
  ELSE
    PERFORM set_config('scopeflow.allow_delete', 'on', true);
    DELETE FROM scopeflow.rate_limits WHERE id IN (SELECT 'review:' || v.id FROM scopeflow.versions v WHERE v.project_id = target);
    DELETE FROM scopeflow.inbound_messages WHERE project_id = target;
    DELETE FROM scopeflow.versions WHERE project_id = target AND status = 'pending';
    GET DIAGNOSTICS removed = ROW_COUNT;
    DELETE FROM scopeflow.review_views WHERE project_id = target;
    DELETE FROM scopeflow.projects WHERE id = target;
    PERFORM set_config('scopeflow.allow_delete', 'off', true);
    result := 'deleted';
  END IF;
  INSERT INTO scopeflow.deletion_audit (id, project_id, owner, actor, db_role, outcome, versions_deleted)
  VALUES (md5(random()::text || clock_timestamp()::text), target, CASE WHEN result = 'not_found' THEN NULL ELSE p.owner END, left(coalesce(actor, 'app'), 120), session_user, result, removed);
  RETURN result;
END $$;
REVOKE ALL ON FUNCTION scopeflow.delete_project_tombstone(text, text, text) FROM PUBLIC;

-- ---------------------------------------------------------------------------------------------
-- C7: daily signed head digest (GET /api/heads/<date>). One row per UTC date, written once.
-- ---------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS scopeflow.head_digests (
  date text PRIMARY KEY,
  digest text NOT NULL,
  heads text NOT NULL,
  projects integer NOT NULL,
  kid text,
  signature text,
  tsa text,
  tsa_token text,
  tsa_gen_time text,
  created text NOT NULL
);
CREATE OR REPLACE FUNCTION scopeflow.guard_head_digests() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  -- A late RFC 3161 token may be attached once; nothing else about a published digest changes.
  IF TG_OP = 'UPDATE' AND OLD.tsa_token IS NULL AND NEW.date = OLD.date AND NEW.digest = OLD.digest AND NEW.heads = OLD.heads
     AND NEW.signature IS NOT DISTINCT FROM OLD.signature AND NEW.kid IS NOT DISTINCT FROM OLD.kid THEN RETURN NEW; END IF;
  RAISE EXCEPTION 'scopeflow: a published head digest is immutable' USING ERRCODE = 'P0001';
END $$;
DROP TRIGGER IF EXISTS head_digests_immutable ON scopeflow.head_digests;
CREATE TRIGGER head_digests_immutable BEFORE UPDATE OR DELETE ON scopeflow.head_digests FOR EACH ROW EXECUTE FUNCTION scopeflow.guard_head_digests();

-- ---------------------------------------------------------------------------------------------
-- M31: one row per cron job run (scripts/cron.mjs); /api/readiness shows the last run per job.
-- ---------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS scopeflow.cron_runs (
  id text PRIMARY KEY,
  job text NOT NULL,
  started text NOT NULL,
  finished text,
  status text NOT NULL CHECK (status IN ('running', 'ok', 'failed')),
  exit_code integer,
  detail text
);
CREATE INDEX IF NOT EXISTS idx_cron_runs_job ON scopeflow.cron_runs (job, started DESC);

-- ---------------------------------------------------------------------------------------------
-- M28: idempotency keys (lib/idempotency.ts). The stored reply is replayed for a retry.
-- ---------------------------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------------------------
-- M23/M24: OAuth grants (token families). A grant is one consent; its code, access and refresh
-- tokens share the family id. Revoking a grant (or detecting replay/reuse) removes the family.
-- ---------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS scopeflow.oauth_grants (
  id text PRIMARY KEY,
  owner text NOT NULL,
  client_id text NOT NULL,
  client_name text NOT NULL,
  domain text NOT NULL,
  verified boolean NOT NULL DEFAULT false,
  scope text NOT NULL,
  resource text NOT NULL,
  created text NOT NULL,
  last_used text,
  revoked text,
  revoked_reason text
);
CREATE INDEX IF NOT EXISTS idx_oauth_grants_owner ON scopeflow.oauth_grants (owner);
ALTER TABLE scopeflow.oauth_codes ADD COLUMN IF NOT EXISTS family text;
ALTER TABLE scopeflow.oauth_codes ADD COLUMN IF NOT EXISTS used text;
ALTER TABLE scopeflow.oauth_tokens ADD COLUMN IF NOT EXISTS family text;
ALTER TABLE scopeflow.oauth_tokens ADD COLUMN IF NOT EXISTS rotated text;
CREATE INDEX IF NOT EXISTS idx_oauth_tokens_family ON scopeflow.oauth_tokens (family);
-- Tokens issued before families existed: one family per (client, owner), with a grant row so they
-- appear in the connected-apps list and can be disconnected one by one.
UPDATE scopeflow.oauth_tokens SET family = 'legacy-' || md5(client_id || ':' || owner) WHERE family IS NULL;
INSERT INTO scopeflow.oauth_grants (id, owner, client_id, client_name, domain, verified, scope, resource, created)
SELECT DISTINCT ON (t.family) t.family, t.owner, t.client_id, coalesce(c.name, 'Connected app'),
       coalesce(substring(c.redirect_uris from '"https?://([^/":]+)'), 'unknown'), false, t.scope, t.resource, t.created
FROM scopeflow.oauth_tokens t LEFT JOIN scopeflow.oauth_clients c ON c.id = t.client_id
WHERE t.family LIKE 'legacy-%'
ORDER BY t.family, t.created
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------------------------
-- SF-14: privacy-preserving product analytics. Events are written by triggers on the tables that
-- record each step, so every route is covered without code changes. Only ids and the event name
-- are stored: never an email, phone, name, IP address, user agent or free text.
-- Owners opt out per account (analytics_opt_out); the operator can switch collection off for the
-- whole server with: ALTER ROLE <app login role> SET scopeflow.analytics = 'off' (docs/ws-10.md).
-- ---------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS scopeflow.analytics_events (
  id bigserial PRIMARY KEY,
  event text NOT NULL CHECK (event IN ('link_opened', 'decision', 'co_proposed', 'co_approved', 'payment_marked', 'invoice_issued')),
  owner text NOT NULL,
  project_id text NOT NULL,
  props jsonb NOT NULL DEFAULT '{}'::jsonb,
  created timestamptz NOT NULL DEFAULT now(),
  exported timestamptz
);
CREATE INDEX IF NOT EXISTS idx_analytics_events_event ON scopeflow.analytics_events (event, created);
CREATE INDEX IF NOT EXISTS idx_analytics_events_owner ON scopeflow.analytics_events (owner);
CREATE TABLE IF NOT EXISTS scopeflow.analytics_opt_out (
  owner text PRIMARY KEY,
  created text NOT NULL
);

CREATE OR REPLACE FUNCTION scopeflow.track(event_name text, project text, extra jsonb DEFAULT '{}'::jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, scopeflow AS $$
DECLARE
  who text;
BEGIN
  IF coalesce(current_setting('scopeflow.analytics', true), 'on') = 'off' THEN RETURN; END IF;
  SELECT owner INTO who FROM scopeflow.projects WHERE id = project;
  IF who IS NULL OR EXISTS (SELECT 1 FROM scopeflow.analytics_opt_out WHERE owner = who) THEN RETURN; END IF;
  INSERT INTO scopeflow.analytics_events (event, owner, project_id, props) VALUES (event_name, who, project, coalesce(extra, '{}'::jsonb));
EXCEPTION WHEN OTHERS THEN
  -- Analytics never blocks the product.
  RAISE WARNING 'scopeflow analytics skipped: %', SQLERRM;
END $$;
REVOKE ALL ON FUNCTION scopeflow.track(text, text, jsonb) FROM PUBLIC;

CREATE OR REPLACE FUNCTION scopeflow.analytics_versions() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, scopeflow AS $$
BEGIN
  IF OLD.status = 'pending' AND NEW.status IN ('approved', 'changes_requested') THEN
    PERFORM scopeflow.track('decision', NEW.project_id, jsonb_build_object('version', NEW.version, 'outcome', NEW.status));
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS versions_analytics ON scopeflow.versions;
CREATE TRIGGER versions_analytics AFTER UPDATE OF status ON scopeflow.versions FOR EACH ROW EXECUTE FUNCTION scopeflow.analytics_versions();

CREATE OR REPLACE FUNCTION scopeflow.analytics_ledger() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, scopeflow AS $$
BEGIN
  IF NEW.kind = 'change_order' THEN
    PERFORM scopeflow.track('co_proposed', NEW.project_id, jsonb_build_object('seq', NEW.seq));
  ELSIF NEW.kind = 'settle' AND NEW.payload LIKE '{%' AND (NEW.payload::jsonb ->> 'outcome') = 'approved' THEN
    PERFORM scopeflow.track('co_approved', NEW.project_id, jsonb_build_object('seq', NEW.seq, 'ref_seq', (NEW.payload::jsonb ->> 'ref_seq')));
  ELSIF NEW.kind IN ('payment', 'payment_received') THEN
    PERFORM scopeflow.track('payment_marked', NEW.project_id, jsonb_build_object('seq', NEW.seq, 'actor', NEW.actor));
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS ledger_analytics ON scopeflow.ledger_entries;
CREATE TRIGGER ledger_analytics AFTER INSERT ON scopeflow.ledger_entries FOR EACH ROW EXECUTE FUNCTION scopeflow.analytics_ledger();

CREATE OR REPLACE FUNCTION scopeflow.analytics_invoices() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, scopeflow AS $$
BEGIN
  PERFORM scopeflow.track('invoice_issued', NEW.project_id, jsonb_build_object('seq', NEW.seq, 'version', NEW.version));
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS invoices_analytics ON scopeflow.invoices;
CREATE TRIGGER invoices_analytics AFTER INSERT ON scopeflow.invoices FOR EACH ROW EXECUTE FUNCTION scopeflow.analytics_invoices();

-- First open of a version's link by someone other than the creator (review_views is written only then).
CREATE OR REPLACE FUNCTION scopeflow.analytics_views() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, scopeflow AS $$
BEGIN
  PERFORM scopeflow.track('link_opened', NEW.project_id, jsonb_build_object('version', NEW.version));
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS review_views_analytics ON scopeflow.review_views;
CREATE TRIGGER review_views_analytics AFTER INSERT ON scopeflow.review_views FOR EACH ROW EXECUTE FUNCTION scopeflow.analytics_views();

-- ---------------------------------------------------------------------------------------------
-- C7: privileges for the runtime role. Tables stay owned by the migration role, so the app role can
-- never ALTER a table, DISABLE a trigger or TRUNCATE. Append-only tables get no UPDATE/DELETE.
-- Later migrations inherit the grants through ALTER DEFAULT PRIVILEGES.
-- ---------------------------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'scopeflow_app') THEN
    RAISE NOTICE 'scopeflow: role scopeflow_app missing; privileges not granted';
    RETURN;
  END IF;
  GRANT USAGE ON SCHEMA scopeflow TO scopeflow_app;
  GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA scopeflow TO scopeflow_app;
  GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA scopeflow TO scopeflow_app;
  REVOKE TRUNCATE, REFERENCES, TRIGGER ON ALL TABLES IN SCHEMA scopeflow FROM scopeflow_app;
  REVOKE ALL ON scopeflow._migrations FROM scopeflow_app;
  -- Ledger entries keep UPDATE only for retention redaction (the triggers allow nothing else).
  REVOKE DELETE ON scopeflow.ledger_entries, scopeflow.head_digests FROM scopeflow_app;
  -- Audit rows and analytics events are written only by SECURITY DEFINER functions.
  REVOKE INSERT, UPDATE, DELETE ON scopeflow.deletion_audit FROM scopeflow_app;
  REVOKE INSERT ON scopeflow.analytics_events FROM scopeflow_app;
  GRANT EXECUTE ON FUNCTION scopeflow.delete_project_tombstone(text, text, text) TO scopeflow_app;
  ALTER DEFAULT PRIVILEGES IN SCHEMA scopeflow GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO scopeflow_app;
  ALTER DEFAULT PRIVILEGES IN SCHEMA scopeflow GRANT USAGE, SELECT ON SEQUENCES TO scopeflow_app;
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE 'scopeflow: could not grant privileges to scopeflow_app; see docs/ws-10.md';
END $$;
