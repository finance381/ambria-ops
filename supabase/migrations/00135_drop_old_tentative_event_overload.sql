-- 00134's CREATE OR REPLACE added a 6th parameter (p_venue_name_other),
-- which Postgres treats as a genuinely different signature -- it created a
-- second overload alongside the original 5-param function instead of
-- replacing it, so every call now fails with "could not choose the best
-- candidate function" between the two. Drop the old signature explicitly;
-- the 6-param version from 00134 is the only one left afterward.

BEGIN;

DROP FUNCTION IF EXISTS public.fn_create_tentative_event(text, integer, date, integer, text);

NOTIFY pgrst, 'reload schema';

COMMIT;
