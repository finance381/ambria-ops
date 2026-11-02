-- "Adjust Expense" on a Store Requisition dept row: the row recovered value
-- that should reduce a specific expense sub-type's running cost (e.g. a
-- laundry job done with store resources instead of being bought in), with
-- no wallet movement at all -- it's a pure ledger adjustment, not a payment.
--
-- expenses.amount_paise has carried CHECK (amount_paise > 0) since 00005 and
-- it's still live, so this can never be a negative expenses row. The actual
-- existing precedent for a credit against an expense sub-type's ledger is
-- Cost Transfers' negative "from" leg -- but that mechanism is inherently
-- two-sided (always a from AND a to, same table, opposite signs) and this
-- is genuinely one-sided: there's no second ledger position being debited.
-- Forcing it through cost_transfers would mean inventing a dummy "to" party
-- and polluting the Cost Transfers list with entries that aren't transfers.
--
-- So this is its own table, read into v_ledger as its own UNION branch --
-- mirroring the exact convention the cost_transfer branches already use
-- (negative amount_paise, status hardcoded 'acknowledged' so it's
-- immediately committed, never "pending"). Deliberately NOT part of
-- store_requisitions.total_paise -- that figure is the requisition's own
-- stock cost (items + casuals); this is a separate financial event against
-- a completely different ledger.
--
-- Child of store_requisition_dept_rows (ON DELETE CASCADE), same as items/
-- casuals -- rpc_update_store_requisition already deletes and rebuilds every
-- dept row on every edit, so these ride along on that same cascade with no
-- extra reversal logic needed (nothing outside v_ledger's own read of this
-- table depends on a row's past existence).
CREATE TABLE public.store_requisition_expense_adjustments (
  id bigserial PRIMARY KEY,
  dept_row_id bigint NOT NULL REFERENCES public.store_requisition_dept_rows(id) ON DELETE CASCADE,
  expense_type_id bigint NOT NULL REFERENCES public.expense_types(id),
  expense_sub_type_id bigint REFERENCES public.expense_sub_types(id),
  amount_paise bigint NOT NULL CHECK (amount_paise > 0),
  meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  remarks text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.store_requisition_expense_adjustments ENABLE ROW LEVEL SECURITY;

-- Same gate as its siblings (sr_items_select / sr_casuals_select, 00073).
DROP POLICY IF EXISTS sr_expense_adj_select ON public.store_requisition_expense_adjustments;
CREATE POLICY sr_expense_adj_select ON public.store_requisition_expense_adjustments FOR SELECT USING (user_can('procurement.requisitions'));

-- v_ledger, unchanged except for the new 4th branch at the end -- the first
-- three UNION ALL arms are copied verbatim from the view's live definition.
CREATE OR REPLACE VIEW public.v_ledger AS
 SELECT ea.id AS allocation_id,
    ea.expense_id,
    COALESCE(ea.department_id, et.department_id, sd.department_id::bigint) AS department_id,
    COALESCE(ea.expense_type_id, e.expense_type_id::bigint) AS expense_type_id,
    COALESCE(ea.expense_sub_type_id, e.expense_sub_type_id::bigint) AS expense_sub_type_id,
    ea.venue_id,
    ea.amount_paise,
    ea.remarks,
    e.expense_date,
    e.description,
    e.status,
    e.user_id,
    e.created_at,
        CASE
            WHEN e.status = ANY (ARRAY['acknowledged'::text, 'deducted'::text]) THEN ea.amount_paise
            ELSE 0::bigint
        END AS committed_paise,
        CASE
            WHEN e.status = ANY (ARRAY['recorded'::text, 'flagged'::text]) THEN ea.amount_paise
            ELSE 0::bigint
        END AS pending_paise,
    ea.source
   FROM expense_allocations ea
     JOIN expenses e ON e.id = ea.expense_id
     LEFT JOIN expense_types et ON et.id = COALESCE(ea.expense_type_id, e.expense_type_id::bigint)
     LEFT JOIN sub_departments sd ON sd.id = et.sub_department_id
  WHERE e.deleted_at IS NULL
UNION ALL
 SELECT NULL::integer AS allocation_id,
    NULL::integer AS expense_id,
    COALESCE(et.department_id, sd.department_id::bigint) AS department_id,
    ct.from_expense_type_id::bigint AS expense_type_id,
    ct.from_expense_sub_type_id::bigint AS expense_sub_type_id,
    NULL::integer AS venue_id,
    - ct.amount_paise AS amount_paise,
    ('Cost transfer #'::text || ct.id) || ' out'::text AS remarks,
    ct.effective_date AS expense_date,
    ct.description,
    'acknowledged'::text AS status,
    ct.created_by AS user_id,
    ct.created_at,
    - ct.amount_paise AS committed_paise,
    0::bigint AS pending_paise,
    'cost_transfer'::text AS source
   FROM cost_transfers ct
     LEFT JOIN expense_types et ON et.id = ct.from_expense_type_id
     LEFT JOIN sub_departments sd ON sd.id = et.sub_department_id
  WHERE ct.from_party_type = 'expense'::text
UNION ALL
 SELECT NULL::integer AS allocation_id,
    NULL::integer AS expense_id,
    COALESCE(et.department_id, sd.department_id::bigint) AS department_id,
    ct.to_expense_type_id::bigint AS expense_type_id,
    ct.to_expense_sub_type_id::bigint AS expense_sub_type_id,
    NULL::integer AS venue_id,
    ct.amount_paise,
    ('Cost transfer #'::text || ct.id) || ' in'::text AS remarks,
    ct.effective_date AS expense_date,
    ct.description,
    'acknowledged'::text AS status,
    ct.created_by AS user_id,
    ct.created_at,
    ct.amount_paise AS committed_paise,
    0::bigint AS pending_paise,
    'cost_transfer'::text AS source
   FROM cost_transfers ct
     LEFT JOIN expense_types et ON et.id = ct.to_expense_type_id
     LEFT JOIN sub_departments sd ON sd.id = et.sub_department_id
  WHERE ct.to_party_type = 'expense'::text
UNION ALL
 SELECT NULL::integer AS allocation_id,
    NULL::integer AS expense_id,
    COALESCE(et.department_id, sd.department_id::bigint) AS department_id,
    sea.expense_type_id AS expense_type_id,
    sea.expense_sub_type_id AS expense_sub_type_id,
    NULL::integer AS venue_id,
    - sea.amount_paise AS amount_paise,
    COALESCE(NULLIF(sea.remarks, ''), ('Store Requisition #'::text || sr.id) || ' adjustment'::text) AS remarks,
    sr.date_from AS expense_date,
    'Store Requisition adjustment'::text AS description,
    'acknowledged'::text AS status,
    sr.created_by AS user_id,
    sea.created_at,
    - sea.amount_paise AS committed_paise,
    0::bigint AS pending_paise,
    'store_req_adjustment'::text AS source
   FROM store_requisition_expense_adjustments sea
     JOIN store_requisition_dept_rows drow ON drow.id = sea.dept_row_id
     JOIN store_requisitions sr ON sr.id = drow.store_requisition_id
     LEFT JOIN expense_types et ON et.id = sea.expense_type_id
     LEFT JOIN sub_departments sd ON sd.id = et.sub_department_id;

-- rpc_submit_store_requisition / rpc_update_store_requisition: identical to
-- 00163 except for the new v_adj loop inserting into the table above from
-- each dept row's optional "adjustments" jsonb array.
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
      INSERT INTO public.store_requisition_expense_adjustments (dept_row_id, expense_type_id, expense_sub_type_id, amount_paise, meta, remarks)
      VALUES (
        v_dept_row_id,
        (v_adj->>'expense_type_id')::bigint,
        NULLIF(v_adj->>'expense_sub_type_id', '')::bigint,
        (v_adj->>'amount_paise')::bigint,
        COALESCE(v_adj->'meta', '{}'::jsonb),
        NULLIF(trim(v_adj->>'remarks'), '')
      );
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
      INSERT INTO public.store_requisition_expense_adjustments (dept_row_id, expense_type_id, expense_sub_type_id, amount_paise, meta, remarks)
      VALUES (
        v_dept_row_id,
        (v_adj->>'expense_type_id')::bigint,
        NULLIF(v_adj->>'expense_sub_type_id', '')::bigint,
        (v_adj->>'amount_paise')::bigint,
        COALESCE(v_adj->'meta', '{}'::jsonb),
        NULLIF(trim(v_adj->>'remarks'), '')
      );
    END LOOP;
  END LOOP;

  UPDATE public.store_requisitions SET total_paise = v_total WHERE id = p_id;

  RETURN p_id;
END;
$function$;

NOTIFY pgrst, 'reload schema';
