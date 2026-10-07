-- PR C: the project's time zone (IANA name, e.g. Asia/Kolkata). Owner-private project metadata,
-- outside the signed content, used to show every timestamp with its zone. NULL = not set (UTC).
ALTER TABLE scopeflow.projects ADD COLUMN IF NOT EXISTS timezone text;
