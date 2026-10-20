-- Review S1: inbound mail without an SPF/DKIM pass (the provider sent no verdict) is quarantined
-- with reason 'auth_unknown', because the allow-list compares a From header the sender controls.
ALTER TABLE scopeflow.inbound_quarantine DROP CONSTRAINT IF EXISTS inbound_quarantine_reason_check;
ALTER TABLE scopeflow.inbound_quarantine ADD CONSTRAINT inbound_quarantine_reason_check CHECK (reason IN ('unknown_sender', 'auth_failed', 'auth_unknown'));
