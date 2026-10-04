-- Two additions to Store Requisition, requested after the first real use:
-- 1. Let the submitter pick which of the "Contracts in this period" rows
--    this requisition is actually for, instead of the table being read-only
--    reference. Stored as a plain bigint[] on the requisition header — it's
--    a loose tag, not a join that drives any calculation, so a simple array
--    column is enough.
-- 2. A free-text remarks field per dept row, same idea as the remarks field
--    AllocationRows already carries elsewhere in the app.
--
-- Both rpc_submit_store_requisition and rpc_update_store_requisition gain a
-- new parameter. Postgres treats a changed parameter list as a distinct
-- overload rather than a replacement (bit us once already on
-- fn_wallet_collect — 00078/00079) — drop the old signatures explicitly
-- before recreating.

BEGIN;

ALTER TABLE public.store_requisitions
  ADD COLUMN IF NOT EXISTS event_ids bigint[] NOT NULL DEFAULT '{}'::bigint[];

ALTER TABLE public.store_requisition_dept_rows
  ADD COLUMN IF NOT EXISTS remarks text;

DROP FUNCTION IF EXISTS public.rpc_submit_store_requisition(date, date, jsonb);
DROP FUNCTION IF EXISTS public.rpc_update_store_requisition(bigint, date, date, jsonb);

CREATE OR REPLACE FUNCTION public.rpc_submit_store_requisition(p_date_from date, p_date_to date, p_dept_rows jsonb, p_event_ids bigint[] DEFAULT '{}'::bigint[])
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_req_id bigint;
  v_dept_row jsonb;
  v_dept_row_id bigint;
  v_item jsonb;
  v_casual jsonb;
  v_total bigint := 0;
  v_amount bigint;
  v_sort int := 0;
BEGIN
  IF NOT user_can('procurement.requisitions') THEN
    RAISE EXCEPTION 'Not permitted';
  END IF;
  IF p_date_to < p_date_from THEN
    RAISE EXCEPTION 'To date cannot be before From date';
  END IF;

  INSERT INTO public.store_requisitions (date_from, date_to, created_by, event_ids)
  VALUES (p_date_from, p_date_to, auth.uid(), COALESCE(p_event_ids, '{}'::bigint[]))
  RETURNING id INTO v_req_id;

  FOR v_dept_row IN SELECT * FROM jsonb_array_elements(p_dept_rows) LOOP
    v_sort := v_sort + 1;
    INSERT INTO public.store_requisition_dept_rows (store_requisition_id, department_id, sub_department_id, section, remarks, sort_order)
    VALUES (
      v_req_id,
      (v_dept_row->>'department_id')::bigint,
      (v_dept_row->>'sub_department_id')::bigint,
      v_dept_row->>'section',
      v_dept_row->>'remarks',
      v_sort
    )
    RETURNING id INTO v_dept_row_id;

    FOR v_item IN SELECT * FROM jsonb_array_elements(COALESCE(v_dept_row->'items', '[]'::jsonb)) LOOP
      v_amount := ROUND((v_item->>'qty')::numeric * (v_item->>'rate_paise')::numeric);
      INSERT INTO public.store_requisition_items (dept_row_id, item_source, item_id, item_name, unit, qty, rate_paise, amount_paise)
      VALUES (
        v_dept_row_id,
        v_item->>'item_source',
        (v_item->>'item_id')::bigint,
        v_item->>'item_name',
        v_item->>'unit',
        (v_item->>'qty')::numeric,
        (v_item->>'rate_paise')::bigint,
        v_amount
      );
      v_total := v_total + v_amount;

      -- Deduct from current stock — no insufficient-stock guard, negative
      -- is allowed by design (see migration header of 00073).
      IF v_item->>'item_source' = 'catering_store' THEN
        UPDATE public.catering_store_items SET qty = qty - (v_item->>'qty')::numeric WHERE id = (v_item->>'item_id')::bigint;
      ELSE
        UPDATE public.inventory_items SET qty = qty - (v_item->>'qty')::numeric WHERE id = (v_item->>'item_id')::bigint;
      END IF;
    END LOOP;

    FOR v_casual IN SELECT * FROM jsonb_array_elements(COALESCE(v_dept_row->'casuals', '[]'::jsonb)) LOOP
      v_amount := ROUND((v_casual->>'qty')::numeric * (v_casual->>'rate_paise')::numeric);
      INSERT INTO public.store_requisition_casuals (dept_row_id, casual_roster_id, casual_type, qty, rate_paise, amount_paise)
      VALUES (
        v_dept_row_id,
        NULLIF(v_casual->>'casual_roster_id', '')::bigint,
        v_casual->>'casual_type',
        (v_casual->>'qty')::numeric,
        (v_casual->>'rate_paise')::bigint,
        v_amount
      );
      v_total := v_total + v_amount;
    END LOOP;
  END LOOP;

  UPDATE public.store_requisitions SET total_paise = v_total WHERE id = v_req_id;

  RETURN v_req_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.rpc_update_store_requisition(p_id bigint, p_date_from date, p_date_to date, p_dept_rows jsonb, p_event_ids bigint[] DEFAULT '{}'::bigint[])
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_item record;
  v_dept_row jsonb;
  v_dept_row_id bigint;
  v_it jsonb;
  v_casual jsonb;
  v_total bigint := 0;
  v_amount bigint;
  v_sort int := 0;
BEGIN
  IF NOT user_can('procurement.requisitions') THEN
    RAISE EXCEPTION 'Not permitted';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.store_requisitions WHERE id = p_id) THEN
    RAISE EXCEPTION 'Store requisition not found';
  END IF;
  IF p_date_to < p_date_from THEN
    RAISE EXCEPTION 'To date cannot be before From date';
  END IF;

  -- Reverse the stock effect of the version being replaced.
  FOR v_item IN
    SELECT sri.item_source, sri.item_id, sri.qty
    FROM public.store_requisition_items sri
    JOIN public.store_requisition_dept_rows dr ON dr.id = sri.dept_row_id
    WHERE dr.store_requisition_id = p_id
  LOOP
    IF v_item.item_source = 'catering_store' THEN
      UPDATE public.catering_store_items SET qty = qty + v_item.qty WHERE id = v_item.item_id;
    ELSE
      UPDATE public.inventory_items SET qty = qty + v_item.qty WHERE id = v_item.item_id;
    END IF;
  END LOOP;

  DELETE FROM public.store_requisition_dept_rows WHERE store_requisition_id = p_id;

  UPDATE public.store_requisitions
  SET date_from = p_date_from, date_to = p_date_to, total_paise = 0, event_ids = COALESCE(p_event_ids, '{}'::bigint[])
  WHERE id = p_id;

  FOR v_dept_row IN SELECT * FROM jsonb_array_elements(p_dept_rows) LOOP
    v_sort := v_sort + 1;
    INSERT INTO public.store_requisition_dept_rows (store_requisition_id, department_id, sub_department_id, section, remarks, sort_order)
    VALUES (
      p_id,
      (v_dept_row->>'department_id')::bigint,
      (v_dept_row->>'sub_department_id')::bigint,
      v_dept_row->>'section',
      v_dept_row->>'remarks',
      v_sort
    )
    RETURNING id INTO v_dept_row_id;

    FOR v_it IN SELECT * FROM jsonb_array_elements(COALESCE(v_dept_row->'items', '[]'::jsonb)) LOOP
      v_amount := ROUND((v_it->>'qty')::numeric * (v_it->>'rate_paise')::numeric);
      INSERT INTO public.store_requisition_items (dept_row_id, item_source, item_id, item_name, unit, qty, rate_paise, amount_paise)
      VALUES (
        v_dept_row_id,
        v_it->>'item_source',
        (v_it->>'item_id')::bigint,
        v_it->>'item_name',
        v_it->>'unit',
        (v_it->>'qty')::numeric,
        (v_it->>'rate_paise')::bigint,
        v_amount
      );
      v_total := v_total + v_amount;

      IF v_it->>'item_source' = 'catering_store' THEN
        UPDATE public.catering_store_items SET qty = qty - (v_it->>'qty')::numeric WHERE id = (v_it->>'item_id')::bigint;
      ELSE
        UPDATE public.inventory_items SET qty = qty - (v_it->>'qty')::numeric WHERE id = (v_it->>'item_id')::bigint;
      END IF;
    END LOOP;

    FOR v_casual IN SELECT * FROM jsonb_array_elements(COALESCE(v_dept_row->'casuals', '[]'::jsonb)) LOOP
      v_amount := ROUND((v_casual->>'qty')::numeric * (v_casual->>'rate_paise')::numeric);
      INSERT INTO public.store_requisition_casuals (dept_row_id, casual_roster_id, casual_type, qty, rate_paise, amount_paise)
      VALUES (
        v_dept_row_id,
        NULLIF(v_casual->>'casual_roster_id', '')::bigint,
        v_casual->>'casual_type',
        (v_casual->>'qty')::numeric,
        (v_casual->>'rate_paise')::bigint,
        v_amount
      );
      v_total := v_total + v_amount;
    END LOOP;
  END LOOP;

  UPDATE public.store_requisitions SET total_paise = v_total WHERE id = p_id;

  RETURN p_id;
END;
$function$;

NOTIFY pgrst, 'reload schema';

COMMIT;
