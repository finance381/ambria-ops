-- 00166 credited the expense sub-type's ledger (via v_ledger) but left the
-- requisition's own total_paise untouched -- so the 500 existed as a credit
-- on the expense side with no matching debit anywhere, rather than the
-- actual double entry asked for: debit this requisition's total, credit the
-- expense sub-type's ledger, by the same amount. Recovered value can't
-- count as this requisition's cost AND sit uncounted against it at once.
--
-- Only the running total changes (v_total -= each adjustment's amount,
-- symmetrically with items/casuals adding to it) -- the adjustment insert
-- itself, v_ledger, and the permission/stock-reversal logic are all
-- untouched from 00166.
CREATE OR REPLACE FUNCTION public.rpc_submit_store_requisition(p_date_from date, p_date_to date, p_dept_rows jsonb, p_event_ids bigint[] DEFAULT '{}'::bigint[], p_requisition_no text DEFAULT NULL::text, p_casual_slip_paths text[] DEFAULT '{}'::text[])
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
  v_adj jsonb;
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

  INSERT INTO public.store_requisitions (date_from, date_to, created_by, event_ids, requisition_no, casual_slip_paths)
  VALUES (p_date_from, p_date_to, auth.uid(), COALESCE(p_event_ids, '{}'::bigint[]), NULLIF(trim(p_requisition_no), ''), COALESCE(p_casual_slip_paths, '{}'::text[]))
  RETURNING id INTO v_req_id;

  FOR v_dept_row IN SELECT * FROM jsonb_array_elements(p_dept_rows) LOOP
    v_sort := v_sort + 1;
    INSERT INTO public.store_requisition_dept_rows (store_requisition_id, department_id, sub_department_id, section, remarks, req_no, req_image_paths, sort_order)
    VALUES (
      v_req_id,
      (v_dept_row->>'department_id')::bigint,
      (v_dept_row->>'sub_department_id')::bigint,
      v_dept_row->>'section',
      v_dept_row->>'remarks',
      NULLIF(trim(v_dept_row->>'req_no'), ''),
      COALESCE((SELECT array_agg(x) FROM jsonb_array_elements_text(COALESCE(v_dept_row->'req_image_paths', '[]'::jsonb)) x), '{}'::text[]),
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

    FOR v_adj IN SELECT * FROM jsonb_array_elements(COALESCE(v_dept_row->'adjustments', '[]'::jsonb)) LOOP
      v_amount := (v_adj->>'amount_paise')::bigint;
      INSERT INTO public.store_requisition_expense_adjustments (dept_row_id, expense_type_id, expense_sub_type_id, amount_paise, meta, remarks)
      VALUES (
        v_dept_row_id,
        (v_adj->>'expense_type_id')::bigint,
        NULLIF(v_adj->>'expense_sub_type_id', '')::bigint,
        v_amount,
        COALESCE(v_adj->'meta', '{}'::jsonb),
        NULLIF(trim(v_adj->>'remarks'), '')
      );
      -- The debit side of the entry v_ledger's new branch credits on the
      -- expense sub-type -- reduces this requisition's own total.
      v_total := v_total - v_amount;
    END LOOP;
  END LOOP;

  UPDATE public.store_requisitions SET total_paise = v_total WHERE id = v_req_id;

  RETURN v_req_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.rpc_update_store_requisition(p_id bigint, p_date_from date, p_date_to date, p_dept_rows jsonb, p_event_ids bigint[] DEFAULT '{}'::bigint[], p_requisition_no text DEFAULT NULL::text, p_casual_slip_paths text[] DEFAULT '{}'::text[])
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
  v_adj jsonb;
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

  -- expense_adjustments carry no stock/wallet effect to reverse -- they
  -- simply cease to exist with the dept row below, same as items/casuals.
  DELETE FROM public.store_requisition_dept_rows WHERE store_requisition_id = p_id;

  UPDATE public.store_requisitions
  SET date_from = p_date_from, date_to = p_date_to, total_paise = 0,
      event_ids = COALESCE(p_event_ids, '{}'::bigint[]),
      requisition_no = NULLIF(trim(p_requisition_no), ''),
      casual_slip_paths = COALESCE(p_casual_slip_paths, '{}'::text[])
  WHERE id = p_id;

  FOR v_dept_row IN SELECT * FROM jsonb_array_elements(p_dept_rows) LOOP
    v_sort := v_sort + 1;
    INSERT INTO public.store_requisition_dept_rows (store_requisition_id, department_id, sub_department_id, section, remarks, req_no, req_image_paths, sort_order)
    VALUES (
      p_id,
      (v_dept_row->>'department_id')::bigint,
      (v_dept_row->>'sub_department_id')::bigint,
      v_dept_row->>'section',
      v_dept_row->>'remarks',
      NULLIF(trim(v_dept_row->>'req_no'), ''),
      COALESCE((SELECT array_agg(x) FROM jsonb_array_elements_text(COALESCE(v_dept_row->'req_image_paths', '[]'::jsonb)) x), '{}'::text[]),
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

    FOR v_adj IN SELECT * FROM jsonb_array_elements(COALESCE(v_dept_row->'adjustments', '[]'::jsonb)) LOOP
      v_amount := (v_adj->>'amount_paise')::bigint;
      INSERT INTO public.store_requisition_expense_adjustments (dept_row_id, expense_type_id, expense_sub_type_id, amount_paise, meta, remarks)
      VALUES (
        v_dept_row_id,
        (v_adj->>'expense_type_id')::bigint,
        NULLIF(v_adj->>'expense_sub_type_id', '')::bigint,
        v_amount,
        COALESCE(v_adj->'meta', '{}'::jsonb),
        NULLIF(trim(v_adj->>'remarks'), '')
      );
      v_total := v_total - v_amount;
    END LOOP;
  END LOOP;

  UPDATE public.store_requisitions SET total_paise = v_total WHERE id = p_id;

  RETURN p_id;
END;
$function$;

NOTIFY pgrst, 'reload schema';
