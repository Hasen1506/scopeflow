-- Per-project archive/delete and an optional client email (owner-private project metadata).
--
-- `archived` is a timestamp (NULL = active). Archiving changes nothing that a client signed:
-- versions, decisions, signatures and ledger entries stay immutable under the SF-04 triggers
-- and review links keep working, so the signed record can still be verified.
--
-- `client_email` is where "Send for signature" delivers the review link. It is kept on the
-- project, not inside the immutable scope content, so it can be corrected without a new
-- version and is never shown to the client or included in the signed content hash.
ALTER TABLE scopeflow.projects ADD COLUMN IF NOT EXISTS archived text;
ALTER TABLE scopeflow.projects ADD COLUMN IF NOT EXISTS client_email text;

-- Deleting a project is allowed only while no client evidence exists (every version still
-- pending, no ledger entries). The application performs it through the audited
-- scopeflow.allow_delete bypass inside one transaction; this trigger re-checks the rule at
-- the database level, so even with the bypass a project that carries a client decision or a
-- ledger entry can only be removed by full account deletion (which sets
-- scopeflow.account_delete as well).
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
     OR NEW.signature IS DISTINCT FROM OLD.signature OR NEW.decision_context IS DISTINCT FROM OLD.decision_context) THEN
    RAISE EXCEPTION 'scopeflow: a recorded decision is immutable' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION scopeflow.guard_ledger() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' AND scopeflow.deletion_allowed() AND coalesce(current_setting('scopeflow.account_delete', true), '') = 'on' THEN RETURN OLD; END IF;
  RAISE EXCEPTION 'scopeflow: ledger entries are append-only' USING ERRCODE = 'P0001';
END $$;
