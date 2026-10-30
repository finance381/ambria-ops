-- 00119 recovered manual fields from already-cancelled rows onto their live
-- replacement, but a live spot-check afterward found something much
-- bigger: hundreds of (contract_no, department, function_date, session)
-- groups with MORE THAN ONE row still marked live (lms_cancelled_at IS
-- NULL) at once -- not just one cancelled + one live. sync-events' old
-- id-based dedup key (two commits before the function+date+session fix)
-- apparently churned on near enough every sync pass, not only on a genuine
-- contract resave, so two straight days of scheduled syncs left a live
-- duplicate behind nearly every run instead of updating the same row in
-- place. The function+date+session key fixes this going forward; this is
-- the one-time cleanup for what already accumulated.
--
-- For each group, keeps the most-recently-synced live row, pulls forward
-- any manual field (Entered mark, manual plate rate, stale-exempt) from
-- whichever sibling has it, then marks every other live row in the group
-- cancelled -- same soft-cancel convention as the sync's own staleness
-- sweep, nothing is deleted.

BEGIN;

CREATE TEMP TABLE _dup_cleanup ON COMMIT DROP AS
WITH ranked AS (
  SELECT id, contract_no, department, function_date, session,
         row_number() OVER (
           PARTITION BY contract_no, department, function_date, coalesce(session, '')
           ORDER BY synced_at DESC NULLS LAST, id DESC
         ) AS rn
  FROM public.events
  WHERE lms_cancelled_at IS NULL
    AND contract_no IS NOT NULL AND contract_no <> ''
    AND department IS NOT NULL
    AND function_date IS NOT NULL
),
keepers AS (
  SELECT contract_no, department, function_date, coalesce(session, '') AS session_key, id AS keep_id
  FROM ranked WHERE rn = 1
)
SELECT r.id AS loser_id, k.keep_id
FROM ranked r
JOIN keepers k
  ON k.contract_no = r.contract_no AND k.department = r.department
 AND k.function_date = r.function_date AND k.session_key = coalesce(r.session, '')
WHERE r.rn > 1;

UPDATE public.events e
SET
  tally_entered_by = coalesce(e.tally_entered_by, (
    SELECT l.tally_entered_by FROM _dup_cleanup dc JOIN public.events l ON l.id = dc.loser_id
    WHERE dc.keep_id = e.id AND l.tally_entered_by IS NOT NULL LIMIT 1
  )),
  tally_entered_at = coalesce(e.tally_entered_at, (
    SELECT l.tally_entered_at FROM _dup_cleanup dc JOIN public.events l ON l.id = dc.loser_id
    WHERE dc.keep_id = e.id AND l.tally_entered_at IS NOT NULL LIMIT 1
  )),
  manual_plate_rate_paise = coalesce(e.manual_plate_rate_paise, (
    SELECT l.manual_plate_rate_paise FROM _dup_cleanup dc JOIN public.events l ON l.id = dc.loser_id
    WHERE dc.keep_id = e.id AND l.manual_plate_rate_paise IS NOT NULL LIMIT 1
  )),
  manual_plate_rate_set_by = coalesce(e.manual_plate_rate_set_by, (
    SELECT l.manual_plate_rate_set_by FROM _dup_cleanup dc JOIN public.events l ON l.id = dc.loser_id
    WHERE dc.keep_id = e.id AND l.manual_plate_rate_set_by IS NOT NULL LIMIT 1
  )),
  manual_plate_rate_set_at = coalesce(e.manual_plate_rate_set_at, (
    SELECT l.manual_plate_rate_set_at FROM _dup_cleanup dc JOIN public.events l ON l.id = dc.loser_id
    WHERE dc.keep_id = e.id AND l.manual_plate_rate_set_at IS NOT NULL LIMIT 1
  )),
  lms_stale_exempt = e.lms_stale_exempt OR EXISTS (
    SELECT 1 FROM _dup_cleanup dc JOIN public.events l ON l.id = dc.loser_id
    WHERE dc.keep_id = e.id AND l.lms_stale_exempt = true
  )
WHERE e.id IN (SELECT keep_id FROM _dup_cleanup);

UPDATE public.events
SET lms_cancelled_at = now()
WHERE id IN (SELECT loser_id FROM _dup_cleanup);

NOTIFY pgrst, 'reload schema';

COMMIT;
