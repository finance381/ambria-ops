-- New permission to gate the Contracts tab (src/modules/events/ContractList.jsx)
-- on its own. Until now it rode on events.list (same gate as the main Events
-- tab) — AdminShell.jsx's SUB_TAB_CONFIG.events and Shell.jsx's mobile Events
-- group both now check events.contracts instead (companion JS change,
-- src/lib/permissions.js PERM_GROUPS).
--
-- Backfilled onto whoever already has events.list, on both profiles and
-- role_defaults, for both surfaces — not just role='admin' (events.list is
-- also granted ad-hoc to individual profiles, not only via role), so this
-- is a conditional UPDATE keyed on the existing grant rather than a fixed
-- role list. Without this, swapping the gate would have silently dropped
-- Contracts access for everyone who could already see it.

BEGIN;

UPDATE profiles
SET desktop_permissions = ARRAY(SELECT DISTINCT unnest(COALESCE(desktop_permissions, '{}') || ARRAY['events.contracts']))
WHERE 'events.list' = ANY(COALESCE(desktop_permissions, '{}'));

UPDATE profiles
SET mobile_permissions = ARRAY(SELECT DISTINCT unnest(COALESCE(mobile_permissions, '{}') || ARRAY['events.contracts']))
WHERE 'events.list' = ANY(COALESCE(mobile_permissions, '{}'));

UPDATE role_defaults
SET desktop_permissions = ARRAY(SELECT DISTINCT unnest(COALESCE(desktop_permissions, '{}') || ARRAY['events.contracts']))
WHERE 'events.list' = ANY(COALESCE(desktop_permissions, '{}'));

UPDATE role_defaults
SET mobile_permissions = ARRAY(SELECT DISTINCT unnest(COALESCE(mobile_permissions, '{}') || ARRAY['events.contracts']))
WHERE 'events.list' = ANY(COALESCE(mobile_permissions, '{}'));

COMMIT;
