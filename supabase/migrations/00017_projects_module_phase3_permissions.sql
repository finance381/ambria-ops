-- Projects module — Phase 3: permission backfill
-- Apply via Supabase SQL editor (this repo's migrations aren't applied through the CLI).
-- Companion JS change: new "Projects" perm group added to src/lib/permissions.js

BEGIN;

-- Admin: all 7 keys, both surfaces, 'all' scope on the 3 scoped keys
UPDATE profiles SET
  desktop_permissions = ARRAY(SELECT DISTINCT unnest(COALESCE(desktop_permissions, '{}') || ARRAY['projects.view','projects.create','projects.edit','projects.approve','projects.ledger.view','projects.ledger.write','projects.delete'])),
  mobile_permissions  = ARRAY(SELECT DISTINCT unnest(COALESCE(mobile_permissions, '{}')  || ARRAY['projects.view','projects.create','projects.edit','projects.approve','projects.ledger.view','projects.ledger.write','projects.delete'])),
  data_scopes = COALESCE(data_scopes, '{}'::jsonb) || jsonb_build_object('projects.view','all','projects.edit','all','projects.ledger.view','all')
WHERE role = 'admin';

UPDATE role_defaults SET
  desktop_permissions = ARRAY(SELECT DISTINCT unnest(COALESCE(desktop_permissions, '{}') || ARRAY['projects.view','projects.create','projects.edit','projects.approve','projects.ledger.view','projects.ledger.write','projects.delete'])),
  mobile_permissions  = ARRAY(SELECT DISTINCT unnest(COALESCE(mobile_permissions, '{}')  || ARRAY['projects.view','projects.create','projects.edit','projects.approve','projects.ledger.view','projects.ledger.write','projects.delete'])),
  data_scopes = COALESCE(data_scopes, '{}'::jsonb) || jsonb_build_object('projects.view','all','projects.edit','all','projects.ledger.view','all')
WHERE role = 'admin';

-- Auditor: view + create + edit + ledger.view (no approve / ledger.write / delete)
UPDATE profiles SET
  desktop_permissions = ARRAY(SELECT DISTINCT unnest(COALESCE(desktop_permissions, '{}') || ARRAY['projects.view','projects.create','projects.edit','projects.ledger.view'])),
  mobile_permissions  = ARRAY(SELECT DISTINCT unnest(COALESCE(mobile_permissions, '{}')  || ARRAY['projects.view','projects.create','projects.edit','projects.ledger.view'])),
  data_scopes = COALESCE(data_scopes, '{}'::jsonb) || jsonb_build_object('projects.view','all','projects.edit','all','projects.ledger.view','all')
WHERE role = 'auditor';

UPDATE role_defaults SET
  desktop_permissions = ARRAY(SELECT DISTINCT unnest(COALESCE(desktop_permissions, '{}') || ARRAY['projects.view','projects.create','projects.edit','projects.ledger.view'])),
  mobile_permissions  = ARRAY(SELECT DISTINCT unnest(COALESCE(mobile_permissions, '{}')  || ARRAY['projects.view','projects.create','projects.edit','projects.ledger.view'])),
  data_scopes = COALESCE(data_scopes, '{}'::jsonb) || jsonb_build_object('projects.view','all','projects.edit','all','projects.ledger.view','all')
WHERE role = 'auditor';

-- Supervisor (closest existing role to "site engineer"): view/create/edit, scoped to own venue
UPDATE profiles SET
  desktop_permissions = ARRAY(SELECT DISTINCT unnest(COALESCE(desktop_permissions, '{}') || ARRAY['projects.view','projects.create','projects.edit'])),
  mobile_permissions  = ARRAY(SELECT DISTINCT unnest(COALESCE(mobile_permissions, '{}')  || ARRAY['projects.view','projects.create','projects.edit'])),
  data_scopes = COALESCE(data_scopes, '{}'::jsonb) || jsonb_build_object('projects.view','own_venue','projects.edit','own_venue')
WHERE role = 'supervisor';

-- role_defaults has no 'supervisor' row at all (a role only ever assigned directly on
-- profiles, never seeded as a template) — upsert rather than UPDATE so this doesn't
-- silently no-op, and so a future supervisor gets these perms by default too.
INSERT INTO role_defaults (role, mobile_permissions, desktop_permissions, data_scopes, venue_ids, updated_at)
VALUES ('supervisor',
        ARRAY['projects.view','projects.create','projects.edit'],
        ARRAY['projects.view','projects.create','projects.edit'],
        jsonb_build_object('projects.view','own_venue','projects.edit','own_venue'),
        '{}', now())
ON CONFLICT (role) DO UPDATE SET
  desktop_permissions = ARRAY(SELECT DISTINCT unnest(COALESCE(role_defaults.desktop_permissions, '{}') || EXCLUDED.desktop_permissions)),
  mobile_permissions  = ARRAY(SELECT DISTINCT unnest(COALESCE(role_defaults.mobile_permissions, '{}')  || EXCLUDED.mobile_permissions)),
  data_scopes = COALESCE(role_defaults.data_scopes, '{}'::jsonb) || EXCLUDED.data_scopes,
  updated_at = now();

COMMIT;

NOTIFY pgrst, 'reload schema';
