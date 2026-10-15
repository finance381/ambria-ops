-- Decor Var Cost: a written detail for sheets the list could not place.
--   * A function sheet with no booking picked (the function is not among the
--     day's bookings) may carry a written function detail in event_detail, so
--     the list can still put its departments together. Picking a booking
--     clears it. fn_dvc_apply_header is 00102's body with that change, and
--     a header that carries no event_detail key at all (the app before
--     these changes) keeps the stored detail instead of clearing it.
--   * fn_dvc_set_event_detail writes the detail on several sheets at once —
--     the list's "Not linked" / "Not for a function" groups — drafts and
--     submitted sheets alike: it is a label only, no amount changes. Same
--     who-may rule as fn_dvc_lock_draft (the maker, or an approver).
-- Run after 00102_decor_var_cost_event_detail.sql.

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
  v_detail text    := nullif(btrim(p_header->>'event_detail'), '');
BEGIN
  IF v_is_fn THEN
    IF v_date IS NULL THEN RAISE EXCEPTION 'Pick the function date'; END IF;
    IF v_venue IS NULL THEN
      v_sub := NULL;
    ELSIF v_sub IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.sub_venues WHERE id = v_sub AND venue_id = v_venue) THEN
      RAISE EXCEPTION 'That sub venue is not at this venue';
    END IF;
    IF v_event IS NOT NULL THEN v_detail := NULL; END IF;
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
    -- A header without the key (an app version from before event_detail)
    -- leaves the detail as it is rather than wiping it.
    event_detail      = CASE WHEN v_is_fn AND v_event IS NOT NULL THEN NULL
                             WHEN p_header ? 'event_detail' THEN left(v_detail, 200)
                             ELSE event_detail END,
    sheet             = CASE WHEN jsonb_typeof(p_header->'sheet') = 'object' THEN p_header->'sheet' ELSE sheet END,
    updated_at        = now()
  WHERE id = p_cost_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_dvc_set_event_detail(p_cost_ids bigint[], p_detail text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_detail text := left(nullif(btrim(p_detail), ''), 200);
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not signed in'; END IF;
  IF NOT user_can('finance.expenses') THEN RAISE EXCEPTION 'Not permitted'; END IF;
  IF v_detail IS NULL THEN RAISE EXCEPTION 'Write the detail'; END IF;
  IF NOT user_can('finance.expenses.approve') AND EXISTS (
    SELECT 1 FROM public.decor_var_costs
    WHERE id = ANY (p_cost_ids) AND created_by IS DISTINCT FROM auth.uid()
  ) THEN
    RAISE EXCEPTION 'Only the person who made these sheets can change them';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.decor_var_costs
    WHERE id = ANY (p_cost_ids) AND is_function AND event_id IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'A sheet linked to a booking takes its name from the booking';
  END IF;

  UPDATE public.decor_var_costs
  SET event_detail = v_detail, updated_at = now()
  WHERE id = ANY (p_cost_ids);
END;
$$;

REVOKE ALL ON FUNCTION public.fn_dvc_set_event_detail(bigint[], text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_dvc_set_event_detail(bigint[], text) TO authenticated;

COMMIT;

NOTIFY pgrst, 'reload schema';
