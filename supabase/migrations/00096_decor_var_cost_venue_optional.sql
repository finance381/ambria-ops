-- Decor Var Cost's "For a function?" setup hard-required venue + sub venue
-- (fn_dvc_apply_header raised "Pick the venue"/"Pick the sub venue", and
-- fn_dvc_submit separately re-blocked on venue_id at final submit) — removed
-- per request. A function's venue isn't always known or relevant when a cost
-- sheet is opened; the fields stay fillable, just optional now. function_date
-- stays required on both paths — the frontend's own validation
-- (DecorVarCost.jsx's setupProblem/fnDone) was relaxed to match in the same
-- change, so this migration brings the DB-side checks in line with it —
-- without it, the UI would let someone past Continue only for the very next
-- save (fn_dvc_save_entry/fn_dvc_update_header both call fn_dvc_apply_header)
-- to fail with the old "Pick the venue" exception.

BEGIN;

CREATE OR REPLACE FUNCTION public.fn_dvc_apply_header(p_cost_id bigint, p_header jsonb)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_is_fn  boolean := coalesce((p_header->>'is_function')::boolean, false);
  v_date   date    := nullif(p_header->>'function_date', '')::date;
  v_venue  integer := nullif(p_header->>'venue_id', '')::integer;
  v_sub    integer := nullif(p_header->>'sub_venue_id', '')::integer;
  v_event  integer := nullif(p_header->>'event_id', '')::integer;
BEGIN
  IF v_is_fn THEN
    IF v_date IS NULL THEN RAISE EXCEPTION 'Pick the function date'; END IF;
    IF v_venue IS NULL THEN
      v_sub := NULL;
    ELSIF v_sub IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.sub_venues WHERE id = v_sub AND venue_id = v_venue) THEN
      RAISE EXCEPTION 'That sub venue is not at this venue';
    END IF;
  ELSE
    v_date := NULL; v_venue := NULL; v_sub := NULL; v_event := NULL;
  END IF;

  UPDATE public.decor_var_costs SET
    sub_department_id = nullif(p_header->>'sub_department_id', '')::integer,
    is_function       = v_is_fn,
    function_date     = v_date,
    event_id          = v_event,
    venue_id          = v_venue,
    sub_venue_id      = v_sub,
    sheet             = CASE WHEN jsonb_typeof(p_header->'sheet') = 'object' THEN p_header->'sheet' ELSE sheet END,
    updated_at        = now()
  WHERE id = p_cost_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_dvc_submit(p_cost_id bigint, p_total_paise bigint)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_cost public.decor_var_costs%rowtype;
BEGIN
  v_cost := public.fn_dvc_lock_draft(p_cost_id);
  IF NOT EXISTS (SELECT 1 FROM public.decor_var_cost_entries WHERE cost_id = p_cost_id) THEN
    RAISE EXCEPTION 'Save at least one dated entry before submitting';
  END IF;
  IF v_cost.is_function AND v_cost.function_date IS NULL THEN
    RAISE EXCEPTION 'The function date is missing';
  END IF;
  IF coalesce(p_total_paise, 0) < 0 THEN RAISE EXCEPTION 'Total cannot be negative'; END IF;
  UPDATE public.decor_var_costs
     SET status = 'submitted', total_paise = coalesce(p_total_paise, 0),
         submitted_by = auth.uid(), submitted_at = now(), updated_at = now()
   WHERE id = p_cost_id;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_dvc_apply_header(bigint, jsonb) FROM PUBLIC;

NOTIFY pgrst, 'reload schema';

COMMIT;
