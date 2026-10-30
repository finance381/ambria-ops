-- sync-events' dedup key briefly keyed off LMS's own per-function-detail-row
-- id (see sync-events/index.ts's mapRow, now fixed to key off function
-- type+date+session instead). LMS regenerates that id on a plain resave of
-- an unchanged contract, so every such resave orphaned a row's manually-
-- entered data onto a newly-cancelled row instead of updating it in place —
-- reported as previously-"Mark Entered" contracts reverting to "Not
-- entered". This recovers that data onto each cancelled row's live
-- replacement, matched the same way a human would recognize "this is the
-- same function": same contract, same department, same function date and
-- session. Only fills in where the live row doesn't already have its own
-- value, so this can't clobber anything set for real on the live row itself.

BEGIN;

UPDATE public.events live
SET
  tally_entered_by = stale.tally_entered_by,
  tally_entered_at = stale.tally_entered_at
FROM public.events stale
WHERE live.lms_cancelled_at IS NULL
  AND stale.lms_cancelled_at IS NOT NULL
  AND live.id <> stale.id
  AND live.contract_no = stale.contract_no
  AND live.department = stale.department
  AND live.function_date = stale.function_date
  AND coalesce(live.session, '') = coalesce(stale.session, '')
  AND live.tally_entered_by IS NULL
  AND stale.tally_entered_by IS NOT NULL;

UPDATE public.events live
SET
  manual_plate_rate_paise = stale.manual_plate_rate_paise,
  manual_plate_rate_set_by = stale.manual_plate_rate_set_by,
  manual_plate_rate_set_at = stale.manual_plate_rate_set_at
FROM public.events stale
WHERE live.lms_cancelled_at IS NULL
  AND stale.lms_cancelled_at IS NOT NULL
  AND live.id <> stale.id
  AND live.contract_no = stale.contract_no
  AND live.department = stale.department
  AND live.function_date = stale.function_date
  AND coalesce(live.session, '') = coalesce(stale.session, '')
  AND live.manual_plate_rate_paise IS NULL
  AND stale.manual_plate_rate_paise IS NOT NULL;

UPDATE public.events live
SET lms_stale_exempt = true
FROM public.events stale
WHERE live.lms_cancelled_at IS NULL
  AND stale.lms_cancelled_at IS NOT NULL
  AND live.id <> stale.id
  AND live.contract_no = stale.contract_no
  AND live.department = stale.department
  AND live.function_date = stale.function_date
  AND coalesce(live.session, '') = coalesce(stale.session, '')
  AND live.lms_stale_exempt = false
  AND stale.lms_stale_exempt = true;

NOTIFY pgrst, 'reload schema';

COMMIT;
