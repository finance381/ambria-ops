-- Store Requisition: a user records what inventory/casual labour was
-- consumed between two dates. On submit it deducts straight from current
-- stock — deliberately allowed to go negative (storekeeping records
-- consumption as it actually happened; a negative balance is a real signal
-- something needs reconciling, not an error to block on).
--
-- inventory_items currently has qty_not_negative CHECK (qty >= 0), which
-- this feature needs gone. blocked_lte_qty CHECK (blocked <= qty) would also
-- break the moment qty goes negative (blocked defaults to 0, and 0 <= a
-- negative number is false) — relaxed to only hold while qty is
-- non-negative, which is the only state it was ever protecting.
-- catering_store_items has no such constraint today, nothing to change there.

BEGIN;

ALTER TABLE public.inventory_items DROP CONSTRAINT IF EXISTS qty_not_negative;

ALTER TABLE public.inventory_items DROP CONSTRAINT IF EXISTS blocked_lte_qty;
ALTER TABLE public.inventory_items ADD CONSTRAINT blocked_lte_qty CHECK (qty < 0 OR blocked <= qty);

-- ── Tables ──────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.store_requisitions (
  id bigserial PRIMARY KEY,
  date_from date NOT NULL,
  date_to date NOT NULL,
  status text NOT NULL DEFAULT 'submitted' CHECK (status IN ('submitted')),
  total_paise bigint NOT NULL DEFAULT 0,
  created_by uuid REFERENCES public.profiles(id) DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.store_requisition_dept_rows (
  id bigserial PRIMARY KEY,
  store_requisition_id bigint NOT NULL REFERENCES public.store_requisitions(id) ON DELETE CASCADE,
  department_id bigint NOT NULL REFERENCES public.departments(id),
  sub_department_id bigint NOT NULL REFERENCES public.sub_departments(id),
  section text, -- kitchen section (Indian/Chinese/...) — only set for Catering -> Kitchen
  sort_order int NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS public.store_requisition_items (
  id bigserial PRIMARY KEY,
  dept_row_id bigint NOT NULL REFERENCES public.store_requisition_dept_rows(id) ON DELETE CASCADE,
  item_source text NOT NULL CHECK (item_source IN ('inventory', 'catering_store')),
  item_id bigint NOT NULL,
  item_name text NOT NULL, -- snapshot — the item's own name can change later
  unit text NOT NULL,
  qty numeric NOT NULL CHECK (qty > 0),
  rate_paise bigint NOT NULL DEFAULT 0, -- snapshot of the resolved "most recent purchase rate" at submit time
  amount_paise bigint NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS public.store_requisition_casuals (
  id bigserial PRIMARY KEY,
  dept_row_id bigint NOT NULL REFERENCES public.store_requisition_dept_rows(id) ON DELETE CASCADE,
  casual_roster_id bigint REFERENCES public.casual_roster(id),
  casual_type text NOT NULL, -- snapshot
  qty numeric NOT NULL CHECK (qty > 0),
  rate_paise bigint NOT NULL DEFAULT 0,
  amount_paise bigint NOT NULL DEFAULT 0
);

ALTER TABLE public.store_requisitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.store_requisition_dept_rows ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.store_requisition_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.store_requisition_casuals ENABLE ROW LEVEL SECURITY;

-- Read gated the same way the Requisitions screen itself is; writes only
-- through rpc_submit_store_requisition below (SECURITY DEFINER, same check).
DROP POLICY IF EXISTS sr_select ON public.store_requisitions;
CREATE POLICY sr_select ON public.store_requisitions FOR SELECT USING (user_can('procurement.requisitions'));
DROP POLICY IF EXISTS sr_rows_select ON public.store_requisition_dept_rows;
CREATE POLICY sr_rows_select ON public.store_requisition_dept_rows FOR SELECT USING (user_can('procurement.requisitions'));
DROP POLICY IF EXISTS sr_items_select ON public.store_requisition_items;
CREATE POLICY sr_items_select ON public.store_requisition_items FOR SELECT USING (user_can('procurement.requisitions'));
DROP POLICY IF EXISTS sr_casuals_select ON public.store_requisition_casuals;
CREATE POLICY sr_casuals_select ON public.store_requisition_casuals FOR SELECT USING (user_can('procurement.requisitions'));

-- ── "Most recent purchase rate, whichever source is newer" ──────────────
-- v_item_purchase_history already unions PO receipts + expense item-receipts
-- by txn_date; stock_batches ("Add new stock" on the item form) is the one
-- source it doesn't cover. This checks both and takes the newer.

CREATE OR REPLACE FUNCTION public.fn_item_latest_rate(p_item_id bigint, p_item_source text)
 RETURNS bigint
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $$
  SELECT rate_paise FROM (
    SELECT rate_paise, txn_date AS d
    FROM public.v_item_purchase_history
    WHERE item_id = p_item_id AND item_source = p_item_source AND rate_paise IS NOT NULL
    UNION ALL
    SELECT rate_paise, created_at::date AS d
    FROM public.stock_batches
    WHERE item_id = p_item_id AND item_source = p_item_source AND rate_paise IS NOT NULL
  ) x
  ORDER BY d DESC NULLS LAST
  LIMIT 1
$$;

-- ── Submit: writes the whole requisition and deducts stock in one go ────
-- p_dept_rows shape:
-- [{ department_id, sub_department_id, section,
--    items: [{ item_source, item_id, item_name, unit, qty, rate_paise }],
--    casuals: [{ casual_roster_id, casual_type, qty, rate_paise }] }]

CREATE OR REPLACE FUNCTION public.rpc_submit_store_requisition(p_date_from date, p_date_to date, p_dept_rows jsonb)
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

  INSERT INTO public.store_requisitions (date_from, date_to, created_by)
  VALUES (p_date_from, p_date_to, auth.uid())
  RETURNING id INTO v_req_id;

  FOR v_dept_row IN SELECT * FROM jsonb_array_elements(p_dept_rows) LOOP
    v_sort := v_sort + 1;
    INSERT INTO public.store_requisition_dept_rows (store_requisition_id, department_id, sub_department_id, section, sort_order)
    VALUES (
      v_req_id,
      (v_dept_row->>'department_id')::bigint,
      (v_dept_row->>'sub_department_id')::bigint,
      v_dept_row->>'section',
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
      -- is allowed by design (see migration header).
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

NOTIFY pgrst, 'reload schema';

COMMIT;
