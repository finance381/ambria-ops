-- Decor Var Cost: a sheet that is not for a function now carries a short
-- "event detail" (what the spend was for). The list groups sheets by it, as
-- it groups function sheets by their function date. fn_dvc_apply_header is
-- 00096's body plus the event_detail column; a function sheet keeps none.

BEGIN;

ALTER TABLE public.decor_var_costs
  ADD COLUMN IF NOT EXISTS event_detail text;

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
    v_detail := NULL;
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
    event_detail      = left(v_detail, 200),
    sheet             = CASE WHEN jsonb_typeof(p_header->'sheet') = 'object' THEN p_header->'sheet' ELSE sheet END,
    updated_at        = now()
  WHERE id = p_cost_id;
END;
$$;

COMMIT;

NOTIFY pgrst, 'reload schema';
