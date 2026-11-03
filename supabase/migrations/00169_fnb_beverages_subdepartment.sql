-- Fnbapp's "Beverages" station needs its own sub-department, not Kitchen --
-- confirmed with the user: Catering already has a "BEV -- Beverages"
-- sub-department, so route that one station there instead of hardcoding
-- every sync to Catering/Kitchen.
--
-- fnb_section_map now carries ops_sub_department per station (default
-- 'Kitchen', overridden to 'Beverages' for that one row) so the function
-- resolves sub-department per-row instead of once up front. ops_section
-- (the 8-value kitchen-section picklist tag) stays NULL for Beverages --
-- that's a separate axis and none of the 8 values fit a beverage station;
-- the dept row still correctly files under Catering/Beverages, it just has
-- no section tag, same as before.

ALTER TABLE public.fnb_section_map
  ADD COLUMN IF NOT EXISTS ops_sub_department text NOT NULL DEFAULT 'Kitchen';

UPDATE public.fnb_section_map
  SET ops_sub_department = 'Beverages',
      notes = 'Routed to Catering -> Beverages sub-department. No matching entry among Ops'' 8 kitchen sections, so the section tag is left blank.'
  WHERE fnb_section_name = 'Beverages';

CREATE OR REPLACE FUNCTION public.fn_fnb_store_requisition_sync(p_payload jsonb)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_sync_ref text := p_payload->>'sync_ref';
  v_existing_id bigint;
  v_dept_id bigint;
  v_sub_dept_id bigint;
  v_section_name text := p_payload->>'section_name';
  v_ops_section text;
  v_ops_sub_department text;
  v_entry_date date := (p_payload->>'entry_date')::date;
  v_event_id bigint := NULLIF(p_payload->>'event_id', '')::bigint;
  v_req_id bigint;
  v_dept_row_id bigint;
  v_item jsonb;
  v_amount bigint;
  v_rate bigint;
  v_total bigint := 0;
  v_remarks text;
BEGIN
  IF v_sync_ref IS NULL OR trim(v_sync_ref) = '' THEN
    RAISE EXCEPTION 'sync_ref required' USING ERRCODE = 'P0001';
  END IF;
  IF v_entry_date IS NULL THEN
    RAISE EXCEPTION 'entry_date required' USING ERRCODE = 'P0001';
  END IF;
  IF v_section_name IS NULL OR trim(v_section_name) = '' THEN
    RAISE EXCEPTION 'section_name required' USING ERRCODE = 'P0001';
  END IF;
  IF jsonb_typeof(p_payload->'items') IS DISTINCT FROM 'array' OR jsonb_array_length(p_payload->'items') = 0 THEN
    RAISE EXCEPTION 'items[] required' USING ERRCODE = 'P0001';
  END IF;

  -- Idempotent: a retried call with the same sync_ref returns what already exists.
  SELECT id INTO v_existing_id FROM public.store_requisitions WHERE fnb_sync_ref = v_sync_ref;
  IF v_existing_id IS NOT NULL THEN
    RETURN v_existing_id;
  END IF;

  SELECT id INTO v_dept_id FROM public.departments WHERE name = 'Catering' LIMIT 1;
  IF v_dept_id IS NULL THEN
    RAISE EXCEPTION 'Catering department not found' USING ERRCODE = 'P0002';
  END IF;

  SELECT ops_section, ops_sub_department INTO v_ops_section, v_ops_sub_department
  FROM public.fnb_section_map WHERE fnb_section_name = v_section_name;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No section mapping for "%" -- add a row to fnb_section_map', v_section_name USING ERRCODE = 'P0001';
  END IF;

  SELECT id INTO v_sub_dept_id FROM public.sub_departments WHERE department_id = v_dept_id AND name = v_ops_sub_department LIMIT 1;
  IF v_sub_dept_id IS NULL THEN
    RAISE EXCEPTION 'Catering -> % sub-department not found', v_ops_sub_department USING ERRCODE = 'P0002';
  END IF;

  v_remarks := 'Synced from Fnbapp'
    || COALESCE(' -- issued by ' || (p_payload->>'issued_by'), '')
    || ' -- station: ' || v_section_name
    || CASE WHEN v_ops_section IS NULL THEN ' (unmapped section, needs review)' ELSE '' END;

  INSERT INTO public.store_requisitions (date_from, date_to, created_by, event_ids, source, fnb_sync_ref, fnb_issued_by)
  VALUES (
    v_entry_date, v_entry_date, NULL,
    CASE WHEN v_event_id IS NOT NULL THEN ARRAY[v_event_id] ELSE '{}'::bigint[] END,
    'fnbapp', v_sync_ref, p_payload->>'issued_by'
  )
  RETURNING id INTO v_req_id;

  INSERT INTO public.store_requisition_dept_rows (store_requisition_id, department_id, sub_department_id, section, remarks, sort_order)
  VALUES (v_req_id, v_dept_id, v_sub_dept_id, v_ops_section, v_remarks, 1)
  RETURNING id INTO v_dept_row_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_payload->'items') LOOP
    IF v_item->>'item_source' NOT IN ('inventory', 'catering_store') THEN
      RAISE EXCEPTION 'item_source must be inventory or catering_store, got %', v_item->>'item_source' USING ERRCODE = 'P0001';
    END IF;
    IF COALESCE((v_item->>'qty')::numeric, 0) <= 0 THEN
      RAISE EXCEPTION 'qty must be > 0 for item %', v_item->>'item_name' USING ERRCODE = 'P0001';
    END IF;

    -- Same "most recent purchase rate" lookup the human form uses when an
    -- item is picked (fn_item_latest_rate, 00073) -- Fnbapp has no price
    -- data to send, so this resolves it the same way a person would get it.
    v_rate := public.fn_item_latest_rate((v_item->>'item_id')::bigint, v_item->>'item_source');
    v_rate := COALESCE(v_rate, 0);
    v_amount := ROUND((v_item->>'qty')::numeric * v_rate);

    INSERT INTO public.store_requisition_items (dept_row_id, item_source, item_id, item_name, unit, qty, rate_paise, amount_paise)
    VALUES (
      v_dept_row_id,
      v_item->>'item_source',
      (v_item->>'item_id')::bigint,
      v_item->>'item_name',
      v_item->>'unit',
      (v_item->>'qty')::numeric,
      v_rate,
      v_amount
    );
    v_total := v_total + v_amount;

    IF v_item->>'item_source' = 'catering_store' THEN
      UPDATE public.catering_store_items SET qty = qty - (v_item->>'qty')::numeric WHERE id = (v_item->>'item_id')::bigint;
    ELSE
      UPDATE public.inventory_items SET qty = qty - (v_item->>'qty')::numeric WHERE id = (v_item->>'item_id')::bigint;
    END IF;
  END LOOP;

  UPDATE public.store_requisitions SET total_paise = v_total WHERE id = v_req_id;

  RETURN v_req_id;
END;
$function$;

NOTIFY pgrst, 'reload schema';
