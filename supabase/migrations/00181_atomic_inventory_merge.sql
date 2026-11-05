-- InventoryForm.jsx merges one item into an existing duplicate in two places
-- (editing an item into a name/key match that's already approved, and an
-- admin's new submission auto-merging into an existing approved item): bump
-- the target's qty, merge each allocation row in, then (edit path only)
-- delete the source item and its allocations. All client-side, several
-- separate calls -- a failure partway through left the target's qty already
-- bumped by the source's stock while the source item still existed with its
-- own qty/allocations intact, double-counting that stock, and a retry would
-- detect the same duplicate and bump the target again, compounding it.
--
-- One function per item family (inventory_items/venue_allocations vs
-- catering_store_items/cs_venue_allocations) rather than one dynamic-SQL
-- function -- their qty columns are different types (integer vs numeric)
-- and their RLS policies differ (catering_store_items has no 'inventory.items'
-- scope branch, and its delete policy is admin-only, not admin/auditor), so
-- sharing one body risked quietly blurring those differences.
--
-- Both are SECURITY DEFINER and so bypass RLS entirely -- each re-checks the
-- exact predicate its table's own inventory_update/cs_items_update (and, for
-- the edit path's source delete, inventory_delete/cs_items_delete) RLS policy
-- already enforces today, so this grants no capability beyond what the
-- existing client-side sequence could already do when RLS allowed it.
--
-- Allocation rows to merge are passed in pre-resolved (form entries plus any
-- DB rows the form didn't have loaded) -- same division as
-- fn_replace_expense_allocations: the caller resolves which rows to add,
-- this function's job is only to make writing them atomic, not to
-- re-derive the merge set.

CREATE OR REPLACE FUNCTION public.fn_merge_inventory_item(
  p_target_id integer,
  p_add_qty integer,
  p_allocs jsonb,
  p_source_id integer DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_qty integer;
  v_cat bigint;
  v_subcat bigint;
  v_submitted uuid;
  v_row jsonb;
  v_venue_id integer;
  v_sub_venue_id integer;
  v_sub_dept_id integer;
  v_alloc_qty integer;
  v_match_id integer;
  v_match_qty integer;
  v_src_cat bigint;
BEGIN
  IF p_target_id IS NULL THEN RAISE EXCEPTION 'target item required'; END IF;

  SELECT qty, category_id, sub_category_id, submitted_by
    INTO v_qty, v_cat, v_subcat, v_submitted
    FROM public.inventory_items WHERE id = p_target_id FOR UPDATE;
  IF v_qty IS NULL THEN RAISE EXCEPTION 'Target item #% not found', p_target_id; END IF;

  -- Mirrors the inventory_update RLS policy's USING clause.
  IF NOT (
    user_role() = ANY (ARRAY['admin','auditor'])
    OR v_submitted = auth.uid()
    OR (user_can('review.dept.approve') AND EXISTS (
          SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND v_cat = ANY (p.category_ids)))
    OR (user_can('inventory.items') AND public.fn_inventory_item_scope_visible(v_cat, v_subcat, v_submitted))
  ) THEN
    RAISE EXCEPTION 'Not permitted to update inventory item #%', p_target_id USING ERRCODE = '42501';
  END IF;

  v_qty := v_qty + COALESCE(p_add_qty, 0);
  UPDATE public.inventory_items SET qty = v_qty WHERE id = p_target_id;

  FOR v_row IN SELECT * FROM jsonb_array_elements(COALESCE(p_allocs, '[]'::jsonb))
  LOOP
    v_venue_id := NULLIF(v_row->>'venue_id', '')::integer;
    v_sub_venue_id := NULLIF(v_row->>'sub_venue_id', '')::integer;
    v_sub_dept_id := NULLIF(v_row->>'sub_department_id', '')::integer;
    v_alloc_qty := ROUND(COALESCE((v_row->>'qty')::numeric, 0));
    IF v_venue_id IS NULL OR v_alloc_qty <= 0 THEN CONTINUE; END IF;

    SELECT id, qty INTO v_match_id, v_match_qty
      FROM public.venue_allocations
     WHERE item_id = p_target_id AND venue_id = v_venue_id
       AND sub_venue_id IS NOT DISTINCT FROM v_sub_venue_id
       AND sub_department_id IS NOT DISTINCT FROM v_sub_dept_id;

    IF v_match_id IS NOT NULL THEN
      UPDATE public.venue_allocations SET qty = v_match_qty + v_alloc_qty WHERE id = v_match_id;
    ELSE
      INSERT INTO public.venue_allocations (item_id, venue_id, sub_venue_id, sub_department_id, qty)
      VALUES (p_target_id, v_venue_id, v_sub_venue_id, v_sub_dept_id, v_alloc_qty);
    END IF;
  END LOOP;

  IF p_source_id IS NOT NULL THEN
    SELECT category_id INTO v_src_cat FROM public.inventory_items WHERE id = p_source_id FOR UPDATE;
    IF FOUND THEN
      -- Mirrors the inventory_delete RLS policy's USING clause (no
      -- submitted_by branch there -- deleting your own item still needs
      -- admin/auditor or dept-approve, unlike updating it).
      IF NOT (
        user_role() = ANY (ARRAY['admin','auditor'])
        OR (user_can('review.dept.approve') AND EXISTS (
              SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND v_src_cat = ANY (p.category_ids)))
      ) THEN
        RAISE EXCEPTION 'Not permitted to delete source item #%', p_source_id USING ERRCODE = '42501';
      END IF;
      DELETE FROM public.venue_allocations WHERE item_id = p_source_id;
      DELETE FROM public.inventory_items WHERE id = p_source_id;
    END IF;
  END IF;

  RETURN v_qty;
END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_merge_catering_store_item(
  p_target_id bigint,
  p_add_qty numeric,
  p_allocs jsonb,
  p_source_id bigint DEFAULT NULL
)
RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_qty numeric;
  v_status text;
  v_submitted uuid;
  v_row jsonb;
  v_venue_id integer;
  v_sub_venue_id integer;
  v_sub_dept_id integer;
  v_alloc_qty numeric;
  v_match_id bigint;
  v_match_qty numeric;
BEGIN
  IF p_target_id IS NULL THEN RAISE EXCEPTION 'target item required'; END IF;

  SELECT qty, status, submitted_by
    INTO v_qty, v_status, v_submitted
    FROM public.catering_store_items WHERE id = p_target_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Target item #% not found', p_target_id; END IF;

  -- Mirrors the cs_items_update RLS policy's USING clause.
  IF NOT (
    v_submitted = auth.uid()
    OR user_role() = ANY (ARRAY['admin','auditor'])
    OR (v_status = ANY (ARRAY['pending_dept','pending']) AND user_can('review.dept.approve'))
  ) THEN
    RAISE EXCEPTION 'Not permitted to update catering store item #%', p_target_id USING ERRCODE = '42501';
  END IF;

  v_qty := COALESCE(v_qty, 0) + COALESCE(p_add_qty, 0);
  UPDATE public.catering_store_items SET qty = v_qty WHERE id = p_target_id;

  FOR v_row IN SELECT * FROM jsonb_array_elements(COALESCE(p_allocs, '[]'::jsonb))
  LOOP
    v_venue_id := NULLIF(v_row->>'venue_id', '')::integer;
    v_sub_venue_id := NULLIF(v_row->>'sub_venue_id', '')::integer;
    v_sub_dept_id := NULLIF(v_row->>'sub_department_id', '')::integer;
    v_alloc_qty := COALESCE((v_row->>'qty')::numeric, 0);
    IF v_venue_id IS NULL OR v_alloc_qty <= 0 THEN CONTINUE; END IF;

    SELECT id, qty INTO v_match_id, v_match_qty
      FROM public.cs_venue_allocations
     WHERE item_id = p_target_id AND venue_id = v_venue_id
       AND sub_venue_id IS NOT DISTINCT FROM v_sub_venue_id
       AND sub_department_id IS NOT DISTINCT FROM v_sub_dept_id;

    IF v_match_id IS NOT NULL THEN
      UPDATE public.cs_venue_allocations SET qty = COALESCE(v_match_qty, 0) + v_alloc_qty WHERE id = v_match_id;
    ELSE
      INSERT INTO public.cs_venue_allocations (item_id, venue_id, sub_venue_id, sub_department_id, qty)
      VALUES (p_target_id, v_venue_id, v_sub_venue_id, v_sub_dept_id, v_alloc_qty);
    END IF;
  END LOOP;

  IF p_source_id IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM public.catering_store_items WHERE id = p_source_id FOR UPDATE) THEN
      -- Mirrors the cs_items_delete RLS policy's USING clause -- admin only,
      -- not even auditor.
      IF user_role() != 'admin' THEN
        RAISE EXCEPTION 'Not permitted to delete source item #%', p_source_id USING ERRCODE = '42501';
      END IF;
      DELETE FROM public.cs_venue_allocations WHERE item_id = p_source_id;
      DELETE FROM public.catering_store_items WHERE id = p_source_id;
    END IF;
  END IF;

  RETURN v_qty;
END;
$function$;

NOTIFY pgrst, 'reload schema';
