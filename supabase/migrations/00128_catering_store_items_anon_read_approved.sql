-- The Ambria FnB Operations app ("Fnbapp") reads catering_store_items
-- (joined with categories, cs_venue_allocations, venues) using the project's
-- anon key only — it never authenticates. The existing cs_items_select
-- policy (00126) only grants SELECT via: admin/auditor role, the row's own
-- submitted_by, or the inventory.items permission + scope function — every
-- branch keys off auth.uid(), which is null for an anon request, so anon
-- always got zero rows with no error.
--
-- This adds a second, additive SELECT policy scoped to anon and restricted
-- to approved items only — pending/draft items (and their submitter, rate,
-- vendor fields) stay invisible to the public anon key, mirroring how
-- categories_select already treats status = 'approved' as publicly readable
-- regardless of auth. RLS policies are OR'd, so this does not loosen the
-- existing authenticated-user policy at all.

DROP POLICY IF EXISTS cs_items_anon_select ON public.catering_store_items;
CREATE POLICY cs_items_anon_select ON public.catering_store_items
  FOR SELECT
  TO anon
  USING (status = 'approved');

-- cs_venue_allocations has no RLS policy in any tracked migration (created
-- outside the migration history, like several other tables this project
-- has). It only carries item_id/venue_id/qty — no sensitive fields — so this
-- mirrors the sibling venue_allocations table's fully-open policies (00010),
-- rather than inventing a narrower rule for just this one.
ALTER TABLE public.cs_venue_allocations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS cs_venue_alloc_select ON public.cs_venue_allocations;
CREATE POLICY cs_venue_alloc_select ON public.cs_venue_allocations FOR SELECT USING (true);

NOTIFY pgrst, 'reload schema';
