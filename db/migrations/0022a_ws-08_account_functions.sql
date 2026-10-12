-- WS-08 (H10/LT-22, WS-10 C7 request): every deletion WS-08 performs runs inside a SECURITY
-- DEFINER function owned by the migration (table-owner) role, so the app never has to
-- set_config('scopeflow.allow_delete') itself. Once WS-10's 0016 lands, deletion_allowed() honours
-- that bypass only for the table owner, i.e. only inside these functions, and production can run as
-- the scopeflow_app login role.
--
--  * ws08_delete_draft(project, owner)        an owner's draft project (no client decision, ledger
--                                              entry or legal hold): the "Delete draft" button and
--                                              draft expiry.
--  * ws08_close_account(owner, now, until)     account deletion: the owner's own data goes; projects
--                                              with client evidence are tombstoned (read-only)
--                                              until `until`; returns the number kept.
--  * ws08_purge_tombstone(project, now)        the retention job: a tombstoned project past its
--                                              retain_until and not on legal hold.
--
-- Tables other workstreams add (WS-03 invoicing, WS-04 payment accounts, WS-05 rate cards, WS-06
-- messaging) are handled when they exist (to_regclass), so this file applies on any merge order.
-- Additive and idempotent (CREATE OR REPLACE).

CREATE OR REPLACE FUNCTION scopeflow.ws08_delete_optional(tbl text, col text, val text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, scopeflow AS $$
BEGIN
  IF to_regclass('scopeflow.' || tbl) IS NOT NULL THEN
    EXECUTE format('DELETE FROM scopeflow.%I WHERE %I = $1', tbl, col) USING val;
  END IF;
END $$;
REVOKE ALL ON FUNCTION scopeflow.ws08_delete_optional(text, text, text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION scopeflow.ws08_delete_draft(target text, want_owner text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, scopeflow AS $$
DECLARE n integer := 0; t text;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('scopeflow:project:' || target, 0));
  PERFORM 1 FROM versions WHERE project_id = target AND project_id IN (SELECT id FROM projects WHERE owner = want_owner) FOR UPDATE;
  -- A decision, a ledger entry or a hold that lands first wins: the draft is kept.
  IF NOT EXISTS (SELECT 1 FROM projects WHERE id = target AND owner = want_owner AND NOT legal_hold AND owner_deleted IS NULL)
     OR EXISTS (SELECT 1 FROM versions WHERE project_id = target AND status <> 'pending')
     OR EXISTS (SELECT 1 FROM ledger_entries WHERE project_id = target) THEN
    RETURN false;
  END IF;
  PERFORM set_config('scopeflow.allow_delete', 'on', true);
  DELETE FROM rate_limits WHERE id IN (SELECT 'review:' || v.id FROM versions v WHERE v.project_id = target);
  DELETE FROM inbound_messages WHERE project_id = target;
  FOREACH t IN ARRAY ARRAY['milestone_schedules', 'invoice_terms', 'delivery_acceptances', 'capture_drafts'] LOOP
    PERFORM scopeflow.ws08_delete_optional(t, 'project_id', target);
  END LOOP;
  DELETE FROM versions WHERE project_id = target AND status = 'pending';
  DELETE FROM projects WHERE id = target AND owner = want_owner AND NOT legal_hold AND NOT EXISTS (SELECT 1 FROM versions WHERE project_id = target);
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n > 0 THEN DELETE FROM review_views WHERE project_id = target; END IF;
  PERFORM set_config('scopeflow.allow_delete', 'off', true);
  RETURN n > 0;
END $$;
REVOKE ALL ON FUNCTION scopeflow.ws08_delete_draft(text, text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION scopeflow.ws08_close_account(want_owner text, at_time text, keep_until text) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, scopeflow AS $$
DECLARE kept integer := 0; t text; pid text; empty text[];
BEGIN
  IF coalesce(want_owner, '') = '' OR at_time IS NULL OR keep_until IS NULL THEN
    RAISE EXCEPTION 'scopeflow: close_account needs an owner and dates' USING ERRCODE = 'P0001';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('scopeflow:owner:' || want_owner, 0));
  IF EXISTS (SELECT 1 FROM projects WHERE owner = want_owner AND legal_hold) THEN
    RAISE EXCEPTION 'scopeflow: a project on legal hold blocks account deletion' USING ERRCODE = 'P0001';
  END IF;
  PERFORM set_config('scopeflow.allow_delete', 'on', true);
  PERFORM set_config('scopeflow.tombstone', 'on', true);

  -- Projects without client evidence (no decision, ledger entry, invoice or confirmed payment) go entirely.
  SELECT coalesce(array_agg(p.id), ARRAY[]::text[]) INTO empty FROM projects p
   WHERE p.owner = want_owner AND p.owner_deleted IS NULL
     AND NOT EXISTS (SELECT 1 FROM versions x WHERE x.project_id = p.id AND x.status <> 'pending')
     AND NOT EXISTS (SELECT 1 FROM ledger_entries x WHERE x.project_id = p.id)
     AND NOT EXISTS (SELECT 1 FROM invoices x WHERE x.project_id = p.id)
     AND NOT EXISTS (SELECT 1 FROM payments x WHERE x.project_id = p.id AND x.status <> 'created');

  DELETE FROM rate_limits WHERE id IN ('owner:' || want_owner, 'key:' || want_owner, 'draft:' || want_owner)
     OR id IN (SELECT 'review:' || v.id FROM versions v JOIN projects p ON p.id = v.project_id WHERE p.owner = want_owner AND v.status = 'pending');
  -- Unsent and undecided versions are the owner's drafts: deleted. Decided versions stay.
  DELETE FROM versions WHERE status = 'pending' AND project_id IN (SELECT id FROM projects WHERE owner = want_owner AND owner_deleted IS NULL);
  DELETE FROM inbound_messages WHERE project_id IN (SELECT id FROM projects WHERE owner = want_owner);

  FOREACH pid IN ARRAY empty LOOP
    DELETE FROM review_views WHERE project_id = pid;
    DELETE FROM payments WHERE project_id = pid;
    FOREACH t IN ARRAY ARRAY['milestone_schedules', 'invoice_terms', 'delivery_acceptances', 'capture_drafts'] LOOP
      PERFORM scopeflow.ws08_delete_optional(t, 'project_id', pid);
    END LOOP;
    PERFORM set_config('scopeflow.account_delete', 'on', true);
    DELETE FROM timestamps WHERE project_id = pid;
    PERFORM set_config('scopeflow.account_delete', 'off', true);
    DELETE FROM projects WHERE id = pid AND owner = want_owner AND NOT EXISTS (SELECT 1 FROM versions x WHERE x.project_id = pid);
  END LOOP;

  -- Everything left has client evidence: tombstoned, read-only (0022 triggers) until keep_until.
  UPDATE projects SET owner_deleted = at_time, retain_until = keep_until, archived = coalesce(archived, at_time), inbound_token = NULL
   WHERE owner = want_owner AND owner_deleted IS NULL;

  -- The owner's own data. Countersign/timestamp/invoice rows of kept projects are untouched.
  PERFORM set_config('scopeflow.account_delete', 'on', true);
  DELETE FROM api_keys WHERE owner = want_owner;
  DELETE FROM template_revisions WHERE template_id IN (SELECT id FROM templates WHERE owner = want_owner);
  DELETE FROM templates WHERE owner = want_owner;
  DELETE FROM drafts WHERE owner = want_owner;
  DELETE FROM account_settings WHERE owner = want_owner;
  DELETE FROM business_profiles WHERE owner = want_owner;
  DELETE FROM oauth_codes WHERE owner = want_owner;
  DELETE FROM oauth_tokens WHERE owner = want_owner;
  DELETE FROM accounts_plans WHERE owner = want_owner;
  DELETE FROM audit_events WHERE owner = want_owner;
  -- Other workstreams' owner-level tables (WS-03 MSME profile, WS-04 payment accounts and OAuth
  -- states, WS-05 rate card, WS-06 contacts, outboxes, WhatsApp links and capture drafts).
  FOREACH t IN ARRAY ARRAY['msme_profiles', 'payment_oauth_states', 'payment_accounts', 'rate_cards', 'owner_contacts',
                           'mail_outbox', 'wa_outbox', 'wa_pending', 'wa_link_codes', 'wa_links', 'capture_drafts',
                           'analytics_events', 'analytics_opt_out'] LOOP
    PERFORM scopeflow.ws08_delete_optional(t, 'owner', want_owner);
  END LOOP;
  PERFORM set_config('scopeflow.account_delete', 'off', true);

  SELECT count(*) INTO kept FROM projects WHERE owner = want_owner AND owner_deleted IS NOT NULL;
  INSERT INTO owner_tombstones (owner, deleted, retain_until, projects_kept, login_deleted)
  VALUES (want_owner, at_time, keep_until, kept, false)
  ON CONFLICT (owner) DO UPDATE SET deleted = excluded.deleted, retain_until = greatest(owner_tombstones.retain_until, excluded.retain_until),
    projects_kept = excluded.projects_kept, login_deleted = false;
  PERFORM set_config('scopeflow.allow_delete', 'off', true);
  PERFORM set_config('scopeflow.tombstone', 'off', true);
  RETURN kept;
END $$;
REVOKE ALL ON FUNCTION scopeflow.ws08_close_account(text, text, text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION scopeflow.ws08_purge_tombstone(target text, at_time text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, scopeflow AS $$
DECLARE n integer := 0; t text;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('scopeflow:project:' || target, 0));
  IF NOT EXISTS (SELECT 1 FROM projects WHERE id = target AND owner_deleted IS NOT NULL AND retain_until IS NOT NULL
                 AND retain_until::timestamptz < at_time::timestamptz AND NOT legal_hold) THEN
    RETURN false;
  END IF;
  PERFORM set_config('scopeflow.allow_delete', 'on', true);
  PERFORM set_config('scopeflow.account_delete', 'on', true);
  PERFORM set_config('scopeflow.tombstone', 'on', true);
  DELETE FROM rate_limits WHERE id IN (SELECT 'review:' || v.id FROM versions v WHERE v.project_id = target);
  FOREACH t IN ARRAY ARRAY['credit_notes', 'receipt_vouchers', 'tds_credits', 'delivery_acceptances', 'milestone_schedules', 'invoice_terms'] LOOP
    PERFORM scopeflow.ws08_delete_optional(t, 'project_id', target);
  END LOOP;
  DELETE FROM invoice_reminders WHERE invoice_id IN (SELECT i.id FROM invoices i WHERE i.project_id = target);
  DELETE FROM invoices WHERE project_id = target;
  DELETE FROM payments WHERE project_id = target;
  DELETE FROM version_cosigns WHERE project_id = target;
  DELETE FROM timestamps WHERE project_id = target;
  DELETE FROM review_views WHERE project_id = target;
  DELETE FROM inbound_messages WHERE project_id = target;
  DELETE FROM ledger_entries WHERE project_id = target;
  DELETE FROM versions WHERE project_id = target;
  DELETE FROM projects WHERE id = target AND owner_deleted IS NOT NULL AND NOT legal_hold;
  GET DIAGNOSTICS n = ROW_COUNT;
  PERFORM set_config('scopeflow.allow_delete', 'off', true);
  PERFORM set_config('scopeflow.account_delete', 'off', true);
  PERFORM set_config('scopeflow.tombstone', 'off', true);
  RETURN n > 0;
END $$;
REVOKE ALL ON FUNCTION scopeflow.ws08_purge_tombstone(text, text) FROM PUBLIC;

-- The runtime role WS-10 creates may call these (and nothing else gains the bypass).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'scopeflow_app') THEN
    GRANT EXECUTE ON FUNCTION scopeflow.ws08_delete_draft(text, text) TO scopeflow_app;
    GRANT EXECUTE ON FUNCTION scopeflow.ws08_close_account(text, text, text) TO scopeflow_app;
    GRANT EXECUTE ON FUNCTION scopeflow.ws08_purge_tombstone(text, text) TO scopeflow_app;
  END IF;
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE 'scopeflow: could not grant ws08 functions to scopeflow_app; see docs/ws-08.md';
END $$;
