-- "Inventory Sub" (inventory.items' own_sub_dept scope value) was matching
-- via the item's category -> sub_department — the coarsest level in the
-- Sub-department -> Category -> Sub-category hierarchy. inventory_items
-- and catering_store_items both already carry their own sub_category_id
-- column directly (set in InventoryForm.jsx), and profiles.sub_category_ids
-- is the existing "Assigned Sub-categories" list (edited in Users.jsx) —
-- the finest-grained assignment already available, so this switches the
-- match straight to that instead of walking up to sub_department.
--
-- fn_inventory_item_scope_visible's signature changes (gains
-- _sub_category_id) — CREATE OR REPLACE with a different parameter list
-- creates a new overload rather than replacing the old one, so the old
-- 2-arg version is dropped explicitly.

CREATE OR REPLACE FUNCTION public.current_user_sub_category_ids()
 RETURNS bigint[]
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT COALESCE(sub_category_ids::bigint[], ARRAY[]::bigint[]) FROM profiles WHERE id = auth.uid()
$function$;

DROP FUNCTION IF EXISTS public.fn_inventory_item_scope_visible(bigint, uuid);

CREATE FUNCTION public.fn_inventory_item_scope_visible(_category_id bigint, _sub_category_id bigint, _submitted_by uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  s text;
  v_sub_dept bigint;
  v_dept bigint;
BEGIN
  s := user_scope('inventory.items');
  IF s = 'all' OR s IS NULL THEN
    RETURN TRUE;
  END IF;
  IF s = 'own' THEN
    RETURN _submitted_by = auth.uid();
  END IF;
  IF s = 'own_sub_dept' THEN
    IF _sub_category_id IS NULL THEN RETURN FALSE; END IF;
    RETURN _sub_category_id = ANY (current_user_sub_category_ids());
  END IF;
  IF s = 'own_expense_type' THEN
    IF _category_id IS NULL THEN RETURN FALSE; END IF;
    SELECT sub_department_id INTO v_sub_dept FROM public.categories WHERE id = _category_id;
    IF v_sub_dept IS NULL THEN RETURN FALSE; END IF;
    SELECT department_id INTO v_dept FROM public.sub_departments WHERE id = v_sub_dept;
    RETURN EXISTS (
      SELECT 1 FROM public.expense_types et
       WHERE (et.sub_department_id = v_sub_dept OR et.department_id = v_dept)
         AND et.id = ANY (current_user_expense_type_ids())
    );
  END IF;
  RETURN TRUE;
END;
$function$;

-- ---- Re-point the three policies at the new 3-arg signature ----

DROP POLICY IF EXISTS inventory_select ON public.inventory_items;
CREATE POLICY inventory_select ON public.inventory_items
  FOR SELECT
  USING (
    (user_role() = ANY (ARRAY['admin'::text, 'auditor'::text]))
    OR (submitted_by = auth.uid())
    OR (EXISTS (
      SELECT 1 FROM public.profiles p
       WHERE p.id = auth.uid() AND inventory_items.category_id = ANY (p.category_ids)
    ))
    OR (user_can('review.inventory'::text) AND fn_review_scope_visible('inventory'::review_domain_e, (id)::bigint))
    OR (user_can('inventory.items'::text) AND fn_inventory_item_scope_visible(category_id, sub_category_id, submitted_by))
  );

DROP POLICY IF EXISTS inventory_update ON public.inventory_items;
CREATE POLICY inventory_update ON public.inventory_items
  FOR UPDATE
  USING (
    (user_role() = ANY (ARRAY['admin'::text, 'auditor'::text]))
    OR (submitted_by = auth.uid())
    OR (user_can('review.dept.approve'::text) AND (EXISTS (
      SELECT 1 FROM public.profiles p
       WHERE p.id = auth.uid() AND inventory_items.category_id = ANY (p.category_ids)
    )))
    OR (user_can('inventory.items'::text) AND fn_inventory_item_scope_visible(category_id, sub_category_id, submitted_by))
  );

DROP POLICY IF EXISTS cs_items_select ON public.catering_store_items;
CREATE POLICY cs_items_select ON public.catering_store_items
  FOR SELECT
  USING (
    (user_role() = ANY (ARRAY['admin'::text, 'auditor'::text]))
    OR (submitted_by = auth.uid())
    OR (user_can('inventory.items'::text) AND fn_inventory_item_scope_visible(category_id, sub_category_id, submitted_by))
  );

NOTIFY pgrst, 'reload schema';
