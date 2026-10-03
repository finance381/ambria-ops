-- Store Requisition list had no edit/delete — once submitted, a mistake
-- (wrong qty, wrong dept) was permanent, and so was its stock deduction.
-- Both operations have to reverse the original stock deduction before
-- doing anything else, since submit deducts straight from current stock.
--
-- Edit is implemented as "reverse old stock effect, wipe old dept rows
-- (cascades items/casuals), re-insert from the new payload, re-deduct" —
-- the same per-row loop rpc_submit_store_requisition already uses, rather
-- than diffing old vs new rows item by item.

BEGIN;

CREATE OR REPLACE FUNCTION public.rpc_delete_store_requisition(p_id bigint)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_item record;
BEGIN
  IF NOT user_can('procurement.requisitions') THEN
    RAISE EXCEPTION 'Not permitted';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.store_requisitions WHERE id = p_id) THEN
    RAISE EXCEPTION 'Store requisition not found';
  END IF;

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

  DELETE FROM public.store_requisitions WHERE id = p_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.rpc_update_store_requisition(p_id bigint, p_date_from date, p_date_to date, p_dept_rows jsonb)
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

  UPDATE public.store_requisitions SET date_from = p_date_from, date_to = p_date_to, total_paise = 0 WHERE id = p_id;

  FOR v_dept_row IN SELECT * FROM jsonb_array_elements(p_dept_rows) LOOP
    v_sort := v_sort + 1;
    INSERT INTO public.store_requisition_dept_rows (store_requisition_id, department_id, sub_department_id, section, sort_order)
    VALUES (
      p_id,
      (v_dept_row->>'department_id')::bigint,
      (v_dept_row->>'sub_department_id')::bigint,
      v_dept_row->>'section',
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
