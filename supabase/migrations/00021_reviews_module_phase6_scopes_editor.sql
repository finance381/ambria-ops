-- Reviews module — Phase 6.2/6.3: reviewer scope editor companion column.
-- profiles.review_scopes and role_defaults.review_scopes already exist (00019).
-- approved_emails (pending-invite users) mirrors profiles' other permission-related
-- columns (mobile_permissions, desktop_permissions, data_scopes, venue_ids, etc.) so a
-- pending invite can be pre-configured before the person signs up — review_scopes needs
-- the same treatment for Users.jsx's edit form to save cleanly for that path too.

ALTER TABLE approved_emails ADD COLUMN IF NOT EXISTS review_scopes jsonb DEFAULT '{}'::jsonb;

NOTIFY pgrst, 'reload schema';
