-- Casual Roster could only ever be edited by admin/auditor (sr_admin/ct_admin
-- hardcoded user_role() = ANY(ARRAY['admin','auditor'])), regardless of the
-- client-side 'admin.masters' or new 'hr.casual_roster' permission. Granting
-- someone 'hr.casual_roster' without a privileged role let them see the
-- screen but every write was silently rejected by RLS. Swap to user_can(),
-- which already bypasses for admin/auditor internally, so this is a strict
-- superset of the old behavior.

BEGIN;

DROP POLICY IF EXISTS ct_admin ON public.casual_types;
CREATE POLICY ct_admin ON public.casual_types
  FOR ALL USING (user_can('hr.casual_roster'));

DROP POLICY IF EXISTS sr_admin ON public.casual_roster;
CREATE POLICY sr_admin ON public.casual_roster
  FOR ALL USING (user_can('hr.casual_roster'));

NOTIFY pgrst, 'reload schema';

COMMIT;
