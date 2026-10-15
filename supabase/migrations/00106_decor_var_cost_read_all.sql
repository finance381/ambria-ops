-- Decor Var Cost: everyone with the Decor Var Cost permission can read every
-- sheet, not just their own — the list groups each function's departments
-- together whoever made them. Changing a sheet is unchanged: its maker or a
-- Decor Var Cost approver (fn_dvc_lock_draft / fn_dvc_delete /
-- fn_dvc_set_event_detail, migration 00105).
-- Run after 00105_decor_var_cost_permission.sql.

BEGIN;

DROP POLICY IF EXISTS dvc_select ON public.decor_var_costs;
CREATE POLICY dvc_select ON public.decor_var_costs FOR SELECT USING (
  created_by = auth.uid() OR user_can('finance.decor_var_cost')
);

DROP POLICY IF EXISTS dvc_entries_select ON public.decor_var_cost_entries;
CREATE POLICY dvc_entries_select ON public.decor_var_cost_entries FOR SELECT USING (
  EXISTS (SELECT 1 FROM public.decor_var_costs c
           WHERE c.id = cost_id
             AND (c.created_by = auth.uid() OR user_can('finance.decor_var_cost')))
);

COMMIT;
