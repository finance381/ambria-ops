-- The 3-hour grace period added to sync-events (previous session) only
-- helps a contract that's merely a transient pagination miss — it still
-- gets re-caught by a later run. Confirmed live that some contracts
-- (#00674, #00675, #00704, and others) are NOT transient misses: repeated,
-- independent full 85-page scans of LMS's own get_venue_contract_
-- information_list, done minutes apart, return the exact same 841 rows /
-- 784 distinct contracts every time — this specific contract is simply
-- never in that list, deterministically, while still fully visible and
-- editable in LMS's own UI. That's a bug in LMS's own listing endpoint, not
-- something our pagination can route around. Manually restoring such a row
-- (clearing lms_cancelled_at) only lasts until the next sync run notices
-- it's still "not touched" and re-cancels it again a few hours later.
--
-- This flag lets an admin mark a specific row as confirmed-live-in-LMS so
-- the stale-flagging pass leaves it alone going forward, independent of
-- whether sync-events can ever actually re-fetch it.
BEGIN;

ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS lms_stale_exempt boolean NOT NULL DEFAULT false;

NOTIFY pgrst, 'reload schema';

COMMIT;
