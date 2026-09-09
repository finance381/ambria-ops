-- API Marketing module — Phase 2: permission backfill.
-- Companion JS change: new "API Marketing" group in src/lib/permissions.js (already edited).
--
-- Grants:
--  - admin: all 18 broadcast.* keys, both surfaces.
--  - auditor: the 5 *.view keys only (read-only across every screen, matching
--    the Review module's auditor treatment) — no edit/send/import/opt_out/reply.
--  - sales: broadcast.quicksend ONLY. Confirmed 'sales' is the live role name
--    (profiles.role CHECK constraint, unchanged since migration 00001/00012).
--    Deliberately not granting any other broadcast.* key to sales — Quick
--    Send is reached inline from QuoteCalc/Events/Contracts, never via the
--    API Marketing tab itself.

BEGIN;

-- Admin: everything
UPDATE profiles SET
  desktop_permissions = ARRAY(SELECT DISTINCT unnest(COALESCE(desktop_permissions, '{}') || ARRAY[
    'broadcast.templates.view','broadcast.templates.edit','broadcast.templates.submit',
    'broadcast.contacts.view','broadcast.contacts.edit','broadcast.contacts.import','broadcast.contacts.opt_out',
    'broadcast.campaigns.view','broadcast.campaigns.create','broadcast.campaigns.send','broadcast.campaigns.cancel',
    'broadcast.inbox.view','broadcast.inbox.reply',
    'broadcast.quicksend','broadcast.analytics.view','broadcast.settings',
    'broadcast.automations.view','broadcast.automations.edit'
  ])),
  mobile_permissions = ARRAY(SELECT DISTINCT unnest(COALESCE(mobile_permissions, '{}') || ARRAY[
    'broadcast.templates.view','broadcast.templates.edit','broadcast.templates.submit',
    'broadcast.contacts.view','broadcast.contacts.edit','broadcast.contacts.import','broadcast.contacts.opt_out',
    'broadcast.campaigns.view','broadcast.campaigns.create','broadcast.campaigns.send','broadcast.campaigns.cancel',
    'broadcast.inbox.view','broadcast.inbox.reply',
    'broadcast.quicksend','broadcast.analytics.view','broadcast.settings',
    'broadcast.automations.view','broadcast.automations.edit'
  ]))
WHERE role = 'admin';

UPDATE role_defaults SET
  desktop_permissions = ARRAY(SELECT DISTINCT unnest(COALESCE(desktop_permissions, '{}') || ARRAY[
    'broadcast.templates.view','broadcast.templates.edit','broadcast.templates.submit',
    'broadcast.contacts.view','broadcast.contacts.edit','broadcast.contacts.import','broadcast.contacts.opt_out',
    'broadcast.campaigns.view','broadcast.campaigns.create','broadcast.campaigns.send','broadcast.campaigns.cancel',
    'broadcast.inbox.view','broadcast.inbox.reply',
    'broadcast.quicksend','broadcast.analytics.view','broadcast.settings',
    'broadcast.automations.view','broadcast.automations.edit'
  ])),
  mobile_permissions = ARRAY(SELECT DISTINCT unnest(COALESCE(mobile_permissions, '{}') || ARRAY[
    'broadcast.templates.view','broadcast.templates.edit','broadcast.templates.submit',
    'broadcast.contacts.view','broadcast.contacts.edit','broadcast.contacts.import','broadcast.contacts.opt_out',
    'broadcast.campaigns.view','broadcast.campaigns.create','broadcast.campaigns.send','broadcast.campaigns.cancel',
    'broadcast.inbox.view','broadcast.inbox.reply',
    'broadcast.quicksend','broadcast.analytics.view','broadcast.settings',
    'broadcast.automations.view','broadcast.automations.edit'
  ]))
WHERE role = 'admin';

-- Auditor: view-only across every screen
UPDATE profiles SET
  desktop_permissions = ARRAY(SELECT DISTINCT unnest(COALESCE(desktop_permissions, '{}') || ARRAY[
    'broadcast.templates.view','broadcast.contacts.view','broadcast.campaigns.view',
    'broadcast.inbox.view','broadcast.analytics.view'
  ])),
  mobile_permissions = ARRAY(SELECT DISTINCT unnest(COALESCE(mobile_permissions, '{}') || ARRAY[
    'broadcast.templates.view','broadcast.contacts.view','broadcast.campaigns.view',
    'broadcast.inbox.view','broadcast.analytics.view'
  ]))
WHERE role = 'auditor';

UPDATE role_defaults SET
  desktop_permissions = ARRAY(SELECT DISTINCT unnest(COALESCE(desktop_permissions, '{}') || ARRAY[
    'broadcast.templates.view','broadcast.contacts.view','broadcast.campaigns.view',
    'broadcast.inbox.view','broadcast.analytics.view'
  ])),
  mobile_permissions = ARRAY(SELECT DISTINCT unnest(COALESCE(mobile_permissions, '{}') || ARRAY[
    'broadcast.templates.view','broadcast.contacts.view','broadcast.campaigns.view',
    'broadcast.inbox.view','broadcast.analytics.view'
  ]))
WHERE role = 'auditor';

-- Sales: quicksend only, both surfaces (used inline, no API Marketing tab access)
UPDATE profiles SET
  desktop_permissions = ARRAY(SELECT DISTINCT unnest(COALESCE(desktop_permissions, '{}') || ARRAY['broadcast.quicksend'])),
  mobile_permissions  = ARRAY(SELECT DISTINCT unnest(COALESCE(mobile_permissions, '{}')  || ARRAY['broadcast.quicksend']))
WHERE role = 'sales';

UPDATE role_defaults SET
  desktop_permissions = ARRAY(SELECT DISTINCT unnest(COALESCE(desktop_permissions, '{}') || ARRAY['broadcast.quicksend'])),
  mobile_permissions  = ARRAY(SELECT DISTINCT unnest(COALESCE(mobile_permissions, '{}')  || ARRAY['broadcast.quicksend']))
WHERE role = 'sales';

NOTIFY pgrst, 'reload schema';

COMMIT;
