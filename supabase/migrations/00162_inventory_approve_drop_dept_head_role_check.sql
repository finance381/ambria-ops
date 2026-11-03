-- fn_is_inventory_dept_head (00058) required role = 'dept. head' literally,
-- on top of holding review.dept.approve and the item's category in
-- category_ids. An auditor (Uday Yadav) had the permission and category
-- assigned by an admin, expecting it to work, but every approve/reject
-- attempt failed with "only the category dept head can approve inventory
-- items" -- the toggle looked granted but silently did nothing because
-- their role isn't literally "dept. head".
--
-- Decided: the permission + category assignment IS the grant now, for any
-- role -- including admin, which (per 00058's own notes) already holds this
-- permission with broad categories as a holdover from before inventory had
-- a single-stage approval flow, and was deliberately excluded there to keep
-- admins "see everything, approve nothing". That exclusion is intentionally
-- dropped here.
--
-- has_category_dept_approver (InventoryForm.jsx's submission-routing check
-- for "does this category have nobody to send it to, so auto-approve") is
-- untouched -- a different question (auto-approve routing vs. who can act
-- on a pending item) that wasn't part of what was asked here.
CREATE OR REPLACE FUNCTION public.fn_is_inventory_dept_head(p_category_id integer, p_user uuid DEFAULT auth.uid())
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT EXISTS(
    SELECT 1 FROM public.profiles
    WHERE id = p_user
      AND active = true
      AND p_category_id = ANY(COALESCE(category_ids, ARRAY[]::integer[]))
      AND (
        'review.dept.approve' = ANY(COALESCE(mobile_permissions,  ARRAY[]::text[]))
        OR
        'review.dept.approve' = ANY(COALESCE(desktop_permissions, ARRAY[]::text[]))
      )
  );
$function$;

NOTIFY pgrst, 'reload schema';
