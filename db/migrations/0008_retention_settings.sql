-- Retention for client network data, and editable wording (account settings).
--
-- account_settings: one row per owner. context_retention_days (NULL = keep, the old behaviour):
-- after that many days the IP address and browser user agent recorded with client decisions and
-- client ledger entries are replaced with "redacted". email_subject/email_body: the owner's
-- "Send for signature" wording. default_exclusions/default_terms: clause text pre-filled into new
-- drafts.
CREATE TABLE IF NOT EXISTS scopeflow.account_settings (
  owner text PRIMARY KEY,
  context_retention_days integer CHECK (context_retention_days IS NULL OR context_retention_days BETWEEN 1 AND 3650),
  email_subject text,
  email_body text,
  default_exclusions text,
  default_terms text,
  updated text NOT NULL
);

-- Redaction is the one change allowed to a recorded decision's context, and only inside a
-- transaction that sets scopeflow.redact=on: every other key of the JSON must stay identical,
-- and ip/user_agent may only become "redacted". Signed fields (content, signer, decided,
-- signature) remain immutable, so receipts keep verifying.
CREATE OR REPLACE FUNCTION scopeflow.redaction_only(old_context text, new_context text) RETURNS boolean
LANGUAGE plpgsql STABLE AS $$
DECLARE o jsonb; n jsonb;
BEGIN
  IF coalesce(current_setting('scopeflow.redact', true), '') <> 'on' OR old_context IS NULL OR new_context IS NULL THEN RETURN false; END IF;
  BEGIN
    o := old_context::jsonb; n := new_context::jsonb;
  EXCEPTION WHEN others THEN RETURN false;
  END;
  RETURN jsonb_typeof(o) = 'object' AND jsonb_typeof(n) = 'object'
     AND (o - 'ip' - 'user_agent' - 'redacted_at') = (n - 'ip' - 'user_agent' - 'redacted_at')
     AND coalesce(n->>'ip', 'redacted') = 'redacted'
     AND coalesce(n->>'user_agent', 'redacted') = 'redacted';
END $$;

CREATE OR REPLACE FUNCTION scopeflow.guard_versions() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF scopeflow.deletion_allowed() AND (OLD.status = 'pending' OR coalesce(current_setting('scopeflow.account_delete', true), '') = 'on') THEN
      RETURN OLD;
    END IF;
    RAISE EXCEPTION 'scopeflow: versions are immutable and cannot be deleted' USING ERRCODE = 'P0001';
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.project_id IS DISTINCT FROM OLD.project_id
     OR NEW.version IS DISTINCT FROM OLD.version OR NEW.content IS DISTINCT FROM OLD.content
     OR NEW.created IS DISTINCT FROM OLD.created THEN
    RAISE EXCEPTION 'scopeflow: version content is immutable' USING ERRCODE = 'P0001';
  END IF;
  IF OLD.status <> 'pending' AND (NEW.status IS DISTINCT FROM OLD.status OR NEW.signer IS DISTINCT FROM OLD.signer
     OR NEW.comment IS DISTINCT FROM OLD.comment OR NEW.decided IS DISTINCT FROM OLD.decided
     OR NEW.signature IS DISTINCT FROM OLD.signature
     OR (NEW.decision_context IS DISTINCT FROM OLD.decision_context AND NOT scopeflow.redaction_only(OLD.decision_context, NEW.decision_context))) THEN
    RAISE EXCEPTION 'scopeflow: a recorded decision is immutable' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION scopeflow.guard_ledger() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' AND scopeflow.deletion_allowed() AND coalesce(current_setting('scopeflow.account_delete', true), '') = 'on' THEN RETURN OLD; END IF;
  IF TG_OP = 'UPDATE' AND ROW(NEW.id, NEW.project_id, NEW.seq, NEW.kind, NEW.baseline_version, NEW.actor, NEW.payload, NEW.ref, NEW.prev_hash, NEW.hash, NEW.created, NEW.signature)
       IS NOT DISTINCT FROM ROW(OLD.id, OLD.project_id, OLD.seq, OLD.kind, OLD.baseline_version, OLD.actor, OLD.payload, OLD.ref, OLD.prev_hash, OLD.hash, OLD.created, OLD.signature)
     AND scopeflow.redaction_only(OLD.context, NEW.context) THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'scopeflow: ledger entries are append-only' USING ERRCODE = 'P0001';
END $$;
REVOKE ALL ON ALL TABLES IN SCHEMA scopeflow FROM PUBLIC;
