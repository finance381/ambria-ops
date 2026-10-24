-- inventory_items' SELECT policy granted visibility via Assigned Categories
-- (profiles.category_ids) unconditionally — no permission check at all —
-- while the sibling UPDATE policy's identical category_ids clause already
-- required review.dept.approve. Net effect: anyone with Assigned Categories
-- set (even for an unrelated reason — e.g. a past review role) saw every
-- item in those categories in the expense form's Item Name picker,
-- completely bypassing whatever Inventory Sub/Expense Type scope their
-- inventory.items permission was actually configured with.
--
-- Brings SELECT in line with UPDATE: this branch now only applies to
-- someone who actually holds review.dept.approve (the dept-head review
-- permission Assigned Categories exists for in the first place).

DROP POLICY IF EXISTS inventory_select ON public.inventory_items;
CREATE POLICY inventory_select ON public.inventory_items
  FOR SELECT
  USING (
    (user_role() = ANY (ARRAY['admin'::text, 'auditor'::text]))
    OR (submitted_by = auth.uid())
    OR (user_can('review.dept.approve'::text) AND (EXISTS (
      SELECT 1 FROM public.profiles p
       WHERE p.id = auth.uid() AND inventory_items.category_id = ANY (p.category_ids)
    )))
    OR (user_can('review.inventory'::text) AND fn_review_scope_visible('inventory'::review_domain_e, (id)::bigint))
    OR (user_can('inventory.items'::text) AND fn_inventory_item_scope_visible(category_id, sub_category_id, submitted_by))
  );

NOTIFY pgrst, 'reload schema';
