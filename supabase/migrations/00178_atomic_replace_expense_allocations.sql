-- ExpenseForm.jsx's edit path deleted an expense's existing allocations and
-- then, as a separate unchecked call, inserted the replacement rows -- a
-- failure in that insert (network blip, an unexpected constraint) left the
-- expense with zero allocations and no way back, since the old ones were
-- already gone. Wraps both in one transaction: a failed insert rolls back
-- the delete too, so the original allocations survive a failed edit intact.
--
-- Takes the already-computed rows as-is (department/department_id already
-- resolved and validated client-side, same as the rest of this session's
-- fixes) rather than re-deriving them here -- this is about transaction
-- safety for the write, not a second copy of that resolution logic.

CREATE OR REPLACE FUNCTION public.fn_replace_expense_allocations(p_expense_id bigint, p_rows jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_owner uuid;
  v_row jsonb;
BEGIN
  SELECT user_id INTO v_owner FROM public.expenses WHERE id = p_expense_id;
  IF v_owner IS NULL THEN
    RAISE EXCEPTION 'Expense not found' USING ERRCODE = 'P0002';
  END IF;
  IF v_owner != auth.uid() AND NOT public.user_can('finance.expenses.approve') THEN
    RAISE EXCEPTION 'Not permitted to edit this expense' USING ERRCODE = '42501';
  END IF;

  DELETE FROM public.expense_allocations WHERE expense_id = p_expense_id;

  FOR v_row IN SELECT * FROM jsonb_array_elements(COALESCE(p_rows, '[]'::jsonb))
  LOOP
    INSERT INTO public.expense_allocations (expense_id, department, department_id, venue_id, expense_type_id, expense_sub_type_id, amount_paise, remarks, source)
    VALUES (
      p_expense_id,
      v_row->>'department',
      NULLIF(v_row->>'department_id', '')::bigint,
      NULLIF(v_row->>'venue_id', '')::bigint,
      NULLIF(v_row->>'expense_type_id', '')::bigint,
      NULLIF(v_row->>'expense_sub_type_id', '')::bigint,
      COALESCE((v_row->>'amount_paise')::bigint, 0),
      v_row->>'remarks',
      COALESCE(v_row->>'source', 'allocation')
    );
  END LOOP;
END;
$function$;

NOTIFY pgrst, 'reload schema';
