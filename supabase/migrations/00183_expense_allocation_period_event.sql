-- Expense form's new "Period" mode (ExpenseForm.jsx) lets one bill span
-- several days and attribute each split-allocation row to a DIFFERENT
-- function/contract, instead of the whole expense anchoring to one shared
-- event_id (the existing single-date "For a function?" behaviour, left
-- untouched). expense_allocations needs its own event_id to carry that.
--
-- Left NULL for every allocation row created outside period mode -- the
-- balance calc (fn_event_group_balance, defined outside tracked migrations)
-- must fall back to the expense's own event_id when no allocation carries
-- one, so every pre-existing expense keeps computing exactly as before.
ALTER TABLE public.expense_allocations
  ADD COLUMN IF NOT EXISTS event_id bigint REFERENCES public.events(id);

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
    INSERT INTO public.expense_allocations (expense_id, department, department_id, venue_id, expense_type_id, expense_sub_type_id, amount_paise, remarks, source, event_id)
    VALUES (
      p_expense_id,
      v_row->>'department',
      NULLIF(v_row->>'department_id', '')::bigint,
      NULLIF(v_row->>'venue_id', '')::bigint,
      NULLIF(v_row->>'expense_type_id', '')::bigint,
      NULLIF(v_row->>'expense_sub_type_id', '')::bigint,
      COALESCE((v_row->>'amount_paise')::bigint, 0),
      v_row->>'remarks',
      COALESCE(v_row->>'source', 'allocation'),
      NULLIF(v_row->>'event_id', '')::bigint
    );
  END LOOP;
END;
$function$;

NOTIFY pgrst, 'reload schema';
