-- WS-09 L9 / SF-21: the owner's theme, kept with the account so it follows them to any browser.
-- theme_style: 'a' Etched or 'b' ScopeFlow original (NULL = never chosen, the default 'b').
-- theme_mode: 'light', 'dark' or 'system' (NULL = never chosen, follow the system).
-- One row per owner in account_settings, so account deletion (which already removes that row) removes it too.
ALTER TABLE scopeflow.account_settings ADD COLUMN IF NOT EXISTS theme_style text CHECK (theme_style IS NULL OR theme_style IN ('a','b'));
ALTER TABLE scopeflow.account_settings ADD COLUMN IF NOT EXISTS theme_mode text CHECK (theme_mode IS NULL OR theme_mode IN ('light','dark','system'));
