-- Fnbapp -> Ops integration: a "Sync to Ops" button on Fnbapp's store-issuing
-- screen creates one real Store Requisition here per station/day, as if a
-- store person had filled in the form by hand (same stock deduction, same
-- tables) -- see the chat history for the full investigation. Summary of
-- the decisions this migration encodes:
--
-- * No fake Ops user. created_by stays NULL for these rows rather than
--   inventing a synthetic profiles row -- profiles.id is a real FK to
--   auth.users (00001), and manufacturing an auth.users row for a
--   non-person "system" identity is the kind of thing that goes wrong in
--   ways a migration shouldn't risk. fnb_issued_by (free text, Fnbapp's own
--   actor identity) carries the attribution instead.
-- * `source` tags where a requisition came from ('manual' | 'fnbapp'),
--   matching the same tagging convention expense_allocations.source
--   already uses elsewhere in this schema.
-- * `fnb_sync_ref` is the idempotency key -- a retried call with the same
--   ref returns the existing requisition instead of creating a duplicate.
-- * department/sub-department is fixed to Catering/Kitchen for this whole
--   integration (Fnbapp only ever syncs kitchen prep issuing) -- resolved
--   by NAME at call time, not a hardcoded id, so it keeps working if those
--   rows are ever recreated with new ids.
-- * `fnb_section_map` translates Fnbapp's 6 station names to Ops' existing
--   8-value kitchen section convention. They don't line up 1:1 (confirmed
--   with Fnbapp: Beverages has no Ops equivalent). Deliberately a table,
--   not a hardcoded CASE, so a wrong or missing mapping is one UPDATE away
--   from fixed -- no redeploy. A station with no row at all fails loudly
--   (RAISE EXCEPTION); a station mapped to a NULL ops_section (Beverages,
--   for now) is let through with its dept row's section left blank rather
--   than guessed into the wrong bucket.
-- * Does NOT skip stock deduction -- the ask was for this to behave exactly
--   like a hand-filled requisition, and that's the one thing the existing
--   rpc_submit_store_requisition always does.
-- * Does NOT go through user_can('procurement.requisitions') -- there is no
--   calling user. The edge function's shared-secret auth is the gate, the
--   same trust model catering-inventory-decrement already uses.

ALTER TABLE public.store_requisitions
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'fnbapp')),
  ADD COLUMN IF NOT EXISTS fnb_sync_ref text,
  ADD COLUMN IF NOT EXISTS fnb_issued_by text;

CREATE UNIQUE INDEX IF NOT EXISTS store_requisitions_fnb_sync_ref_uniq
  ON public.store_requisitions(fnb_sync_ref) WHERE fnb_sync_ref IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.fnb_section_map (
  fnb_section_name text PRIMARY KEY,
  ops_section text,  -- NULL = deliberately unmapped; dept row's section is left blank
  notes text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.fnb_section_map ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS fnb_section_map_select ON public.fnb_section_map;
CREATE POLICY fnb_section_map_select ON public.fnb_section_map FOR SELECT USING (user_can('procurement.requisitions'));

-- Best-effort starting mapping from Fnbapp's 6 RECIPE_DB.cats station names
-- (confirmed list) to Ops' 8-value KITCHEN_SECTIONS convention
-- (StoreRequisitionForm.jsx) -- edit this table directly to correct any of
-- these, no redeploy needed.
INSERT INTO public.fnb_section_map (fnb_section_name, ops_section, notes) VALUES
  ('Indian Tandoor',        'Tandoor', NULL),
  ('Chinese & Pan-Asian',   'Chinese', NULL),
  ('Halwai & Savoury',      'Halwai',  NULL),
  ('Indian Main Course',    'Indian',  NULL),
  ('Indian Desserts',       'Indian',  'Approximate -- Ops has no dedicated Desserts section.'),
  ('Beverages',             NULL,      'No matching Ops kitchen section. Dept row is created under Catering/Kitchen with a blank section until a real mapping is decided.')
ON CONFLICT (fnb_section_name) DO NOTHING;

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
  SELECT id INTO v_sub_dept_id FROM public.sub_departments WHERE department_id = v_dept_id AND name = 'Kitchen' LIMIT 1;
  IF v_sub_dept_id IS NULL THEN
    RAISE EXCEPTION 'Catering -> Kitchen sub-department not found' USING ERRCODE = 'P0002';
  END IF;

  SELECT ops_section INTO v_ops_section
  FROM public.fnb_section_map WHERE fnb_section_name = v_section_name;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No section mapping for "%" -- add a row to fnb_section_map', v_section_name USING ERRCODE = 'P0001';
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
