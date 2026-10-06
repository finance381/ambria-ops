-- fn_extra_plate_cancel wrote its event_ledger reversal row with
-- entry_type = 'collection_reversal', which is not in
-- event_ledger_entry_type_check's allowed list ('collection', 'lms_advance',
-- 'expense', 'requisition', 'po', 'refund', 'adjustment') — so every
-- Extra Plates collection cancel failed with that constraint violation.
-- Same bug, and the same fix, as fn_wallet_collect_cancel in 00051: the
-- reversal is an 'adjustment' (direction = 'out' already says it takes the
-- money back out).
--
-- The function lives only in the database (it was never in a migration),
-- so rather than retype it, this edits the live definition: read it, swap
-- that one literal, and re-create it — everything else stays exactly as it
-- is. The literal must appear exactly once (the event_ledger insert; the
-- wallet row uses 'extra_plate_cancel'), or nothing is changed. Run again
-- after it has applied, it finds no 'collection_reversal' and does nothing.

DO $$
DECLARE
  v_def   text;
  v_count integer;
BEGIN
  v_def := pg_get_functiondef('public.fn_extra_plate_cancel'::regproc);
  v_count := (length(v_def) - length(replace(v_def, '''collection_reversal''', ''))) / length('''collection_reversal''');

  IF v_count = 0 THEN
    RAISE NOTICE 'fn_extra_plate_cancel: no collection_reversal literal — already fixed, nothing to do';
    RETURN;
  END IF;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'fn_extra_plate_cancel: expected one collection_reversal literal, found % — not changed', v_count;
  END IF;

  EXECUTE replace(v_def, '''collection_reversal''', '''adjustment''');
  RAISE NOTICE 'fn_extra_plate_cancel: event_ledger reversal entry_type is now adjustment';
END
$$;

NOTIFY pgrst, 'reload schema';
