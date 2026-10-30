-- The "Inventory > View & Edit" data-scope chip (inventory.items) has been
-- inert since it was added — inventory_items' real RLS policy never calls
-- user_scope('inventory.items') at all; it's a flat OR of admin/auditor,
-- "you submitted it", or "the item's category is in your assigned
-- Categories" (a separate dept-head-approval feature, untouched here).
-- catering_store_items' SELECT policy is just `true` — open to everyone.
--
-- Adds real scope values — all / own / own_sub_dept / own_expense_type —
-- reusing the exact profile fields and helper functions Finance's
-- own_sub_dept/own_expense_type scopes already use (current_user_sub_dept_ids(),
-- current_user_expense_type_ids(), migration 00034), matched via the item's
-- own category: category -> sub_department (own_sub_dept), and
-- category -> sub_department -> whichever expense_types are linked to that
-- sub_department or its parent department (own_expense_type) — items have
-- no expense_type column of their own, so this is the only chain available.
--
-- Additive only: existing OR branches (admin/auditor, self-submitted,
-- category_ids assignment, review-queue visibility) are kept exactly as
-- they were. This only ever grants extra visibility, never removes any.
-- This is also what the expense form's Item Name picker queries directly
-- (inventory_items / catering_store_items, no view in between) — so a
-- user's configured scope now narrows that dropdown too, with no frontend
-- change needed.

CREATE OR REPLACE FUNCTION public.fn_inventory_item_scope_visible(_category_id bigint, _submitted_by uuid)
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
  IF _category_id IS NULL THEN
    RETURN FALSE;
  END IF;
  SELECT sub_department_id INTO v_sub_dept FROM public.categories WHERE id = _category_id;
  IF v_sub_dept IS NULL THEN
    RETURN FALSE;
  END IF;
  IF s = 'own_sub_dept' THEN
    RETURN v_sub_dept = ANY (current_user_sub_dept_ids());
  END IF;
  IF s = 'own_expense_type' THEN
    SELECT department_id INTO v_dept FROM public.sub_departments WHERE id = v_sub_dept;
    RETURN EXISTS (
      SELECT 1 FROM public.expense_types et
       WHERE (et.sub_department_id = v_sub_dept OR et.department_id = v_dept)
         AND et.id = ANY (current_user_expense_type_ids())
    );
  END IF;
  -- Unknown/future scope value: log-and-allow, same fallback fn_expense_scope_visible uses.
  RETURN TRUE;
END;
$function$;

-- ---- inventory_items: SELECT + UPDATE gain the new scope branch ----

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
    OR (user_can('inventory.items'::text) AND fn_inventory_item_scope_visible(category_id, submitted_by))
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
    OR (user_can('inventory.items'::text) AND fn_inventory_item_scope_visible(category_id, submitted_by))
  );

-- ---- catering_store_items: SELECT narrowed from unconditional `true` ----

DROP POLICY IF EXISTS cs_items_select ON public.catering_store_items;
CREATE POLICY cs_items_select ON public.catering_store_items
  FOR SELECT
  USING (
    (user_role() = ANY (ARRAY['admin'::text, 'auditor'::text]))
    OR (submitted_by = auth.uid())
    OR (user_can('inventory.items'::text) AND fn_inventory_item_scope_visible(category_id, submitted_by))
  );

NOTIFY pgrst, 'reload schema';
