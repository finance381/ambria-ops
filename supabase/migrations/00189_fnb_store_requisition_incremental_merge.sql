-- Fnbapp syncs incrementally throughout the day (1 item now, 3 more later,
-- same function/station) -- from their side that's one evolving requisition
-- submitted in pieces, not N distinct events. Previously every call inserted
-- a brand-new store_requisitions row (the only dedup was sync_ref, which
-- only catches an exact retry of the same call) -- confirmed and discussed
-- with Fnbapp directly. This adds an actual merge: a new sync for the same
-- (entry_date, Fnbapp's own section_name, event_id) as an existing
-- source='fnbapp' row folds its items into that row (summing qty on a
-- repeated item) instead of creating a new one. Manual (source='manual')
-- requisitions are never touched by this -- scoped to source='fnbapp' rows
-- only, on purpose.
--
-- Key is Fnbapp's own raw section_name, not the resolved ops_section/
-- ops_sub_department -- fnb_section_map is many-to-one (several of their
-- stations can resolve to the same Ops section), and merging across
-- genuinely different physical stations just because they share an Ops
-- section would be a different, bigger decision than what was asked for
-- here. Needs its own column to match on (store_requisition_dept_rows had
-- nothing queryable -- the station name only ever existed inside a free-text
-- remarks blob).
--
-- Rate behavior worth knowing: a merge recomputes the WHOLE cumulative qty
-- at today's latest purchase rate (fn_item_latest_rate), not qty-tranche by
-- qty-tranche -- same simplification the function already made for a single
-- call (it was never a historical price ledger), just now visibly extended
-- across syncs: a later sync's rate lookup can revalue what an earlier sync
-- already recorded for the same item, not just the new increment.

ALTER TABLE public.store_requisition_dept_rows
  ADD COLUMN IF NOT EXISTS fnb_section_name text;

-- fnb_sync_ref (scalar, unique) can't represent "every call that has
-- contributed to this now-merged row" -- fnb_sync_refs carries that; the
-- original scalar column is left as whichever sync_ref first created the
-- row (existing rows backfilled as-is), kept for anything still reading it.
ALTER TABLE public.store_requisitions
  ADD COLUMN IF NOT EXISTS fnb_sync_refs text[] NOT NULL DEFAULT '{}';

UPDATE public.store_requisitions
  SET fnb_sync_refs = ARRAY[fnb_sync_ref]
  WHERE fnb_sync_ref IS NOT NULL AND fnb_sync_refs = '{}';

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
  v_event_ids bigint[];
  v_req_id bigint;
  v_dept_row_id bigint;
  v_item jsonb;
  v_amount bigint;
  v_rate bigint;
  v_total bigint := 0;
  v_remarks text;
  v_existing_item_id bigint;
  v_existing_qty numeric;
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

  -- Idempotent: a retried call with the same sync_ref -- whether it created
  -- its own row or merged into an existing one -- returns that same row,
  -- never re-deducting or re-merging.
  SELECT id INTO v_existing_id FROM public.store_requisitions WHERE v_sync_ref = ANY(fnb_sync_refs);
  IF v_existing_id IS NOT NULL THEN
    RETURN v_existing_id;
  END IF;

  v_event_ids := CASE WHEN v_event_id IS NOT NULL THEN ARRAY[v_event_id] ELSE '{}'::bigint[] END;

  SELECT ops_section, ops_sub_department INTO v_ops_section, v_ops_sub_department
  FROM public.fnb_section_map WHERE fnb_section_name = v_section_name;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No section mapping for "%" -- add a row to fnb_section_map', v_section_name USING ERRCODE = 'P0001';
  END IF;

  SELECT id INTO v_dept_id FROM public.departments WHERE name = 'Catering' LIMIT 1;
  IF v_dept_id IS NULL THEN
    RAISE EXCEPTION 'Catering department not found' USING ERRCODE = 'P0002';
  END IF;
  SELECT id INTO v_sub_dept_id FROM public.sub_departments WHERE department_id = v_dept_id AND name = v_ops_sub_department LIMIT 1;
  IF v_sub_dept_id IS NULL THEN
    RAISE EXCEPTION 'Catering -> % sub-department not found', v_ops_sub_department USING ERRCODE = 'P0002';
  END IF;

  -- ═══ Find an open (same day, same station, same function) Fnbapp row to merge into ═══
  SELECT sr.id, dr.id INTO v_req_id, v_dept_row_id
  FROM public.store_requisitions sr
  JOIN public.store_requisition_dept_rows dr ON dr.store_requisition_id = sr.id
  WHERE sr.source = 'fnbapp'
    AND sr.date_from = v_entry_date AND sr.date_to = v_entry_date
    AND sr.event_ids = v_event_ids
    AND dr.fnb_section_name = v_section_name
  LIMIT 1;

  IF v_req_id IS NOT NULL THEN
    -- ═══ Merge: fold each incoming item into the existing dept row ═══
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_payload->'items') LOOP
      IF v_item->>'item_source' NOT IN ('inventory', 'catering_store') THEN
        RAISE EXCEPTION 'item_source must be inventory or catering_store, got %', v_item->>'item_source' USING ERRCODE = 'P0001';
      END IF;
      IF COALESCE((v_item->>'qty')::numeric, 0) <= 0 THEN
        RAISE EXCEPTION 'qty must be > 0 for item %', v_item->>'item_name' USING ERRCODE = 'P0001';
      END IF;

      v_rate := COALESCE(public.fn_item_latest_rate((v_item->>'item_id')::bigint, v_item->>'item_source'), 0);

      SELECT id, qty INTO v_existing_item_id, v_existing_qty
      FROM public.store_requisition_items
      WHERE dept_row_id = v_dept_row_id
        AND item_source = v_item->>'item_source'
        AND item_id = (v_item->>'item_id')::bigint;

      IF v_existing_item_id IS NOT NULL THEN
        v_existing_qty := v_existing_qty + (v_item->>'qty')::numeric;
        v_amount := ROUND(v_existing_qty * v_rate);
        UPDATE public.store_requisition_items
          SET qty = v_existing_qty, rate_paise = v_rate, amount_paise = v_amount
          WHERE id = v_existing_item_id;
      ELSE
        v_amount := ROUND((v_item->>'qty')::numeric * v_rate);
        INSERT INTO public.store_requisition_items (dept_row_id, item_source, item_id, item_name, unit, qty, rate_paise, amount_paise)
        VALUES (
          v_dept_row_id, v_item->>'item_source', (v_item->>'item_id')::bigint, v_item->>'item_name',
          v_item->>'unit', (v_item->>'qty')::numeric, v_rate, v_amount
        );
      END IF;

      -- The newly-issued qty is genuinely new stock leaving right now --
      -- deducted once per call regardless of whether its item row is new or
      -- topped up.
      IF v_item->>'item_source' = 'catering_store' THEN
        UPDATE public.catering_store_items SET qty = qty - (v_item->>'qty')::numeric WHERE id = (v_item->>'item_id')::bigint;
      ELSE
        UPDATE public.inventory_items SET qty = qty - (v_item->>'qty')::numeric WHERE id = (v_item->>'item_id')::bigint;
      END IF;
    END LOOP;

    SELECT COALESCE(SUM(amount_paise), 0) INTO v_total
    FROM public.store_requisition_items sri
    JOIN public.store_requisition_dept_rows dr ON dr.id = sri.dept_row_id
    WHERE dr.store_requisition_id = v_req_id;

    UPDATE public.store_requisitions
      SET total_paise = v_total, fnb_sync_refs = array_append(fnb_sync_refs, v_sync_ref)
      WHERE id = v_req_id;

    RETURN v_req_id;
  END IF;

  -- ═══ No open row -- create one, exactly as before ═══
  v_remarks := 'Synced from Fnbapp'
    || COALESCE(' -- issued by ' || (p_payload->>'issued_by'), '')
    || ' -- station: ' || v_section_name
    || CASE WHEN v_ops_section IS NULL THEN ' (unmapped section, needs review)' ELSE '' END;

  INSERT INTO public.store_requisitions (date_from, date_to, created_by, event_ids, source, fnb_sync_ref, fnb_sync_refs, fnb_issued_by)
  VALUES (
    v_entry_date, v_entry_date, NULL, v_event_ids,
    'fnbapp', v_sync_ref, ARRAY[v_sync_ref], p_payload->>'issued_by'
  )
  RETURNING id INTO v_req_id;

  INSERT INTO public.store_requisition_dept_rows (store_requisition_id, department_id, sub_department_id, section, remarks, sort_order, fnb_section_name)
  VALUES (v_req_id, v_dept_id, v_sub_dept_id, v_ops_section, v_remarks, 1, v_section_name)
  RETURNING id INTO v_dept_row_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_payload->'items') LOOP
    IF v_item->>'item_source' NOT IN ('inventory', 'catering_store') THEN
      RAISE EXCEPTION 'item_source must be inventory or catering_store, got %', v_item->>'item_source' USING ERRCODE = 'P0001';
    END IF;
    IF COALESCE((v_item->>'qty')::numeric, 0) <= 0 THEN
      RAISE EXCEPTION 'qty must be > 0 for item %', v_item->>'item_name' USING ERRCODE = 'P0001';
    END IF;

    v_rate := COALESCE(public.fn_item_latest_rate((v_item->>'item_id')::bigint, v_item->>'item_source'), 0);
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
