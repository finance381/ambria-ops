-- Requisitions.jsx's convertToExpense() did this as four separate client-side
-- calls (expense insert, allocations insert, wallet_self_debit, then
-- fulfill_expense_requisition) with most of the errors unchecked. A failure
-- in any later step left an orphaned expense (no allocation, no wallet
-- debit) behind an unchanged 'approved' status -- which the client's own
-- guard re-admits, so a retry (or just clicking the button again) created a
-- genuine second expense and a second wallet debit for the same
-- requisition. fulfill_expense_requisition already took a p_expense_id
-- parameter but never did anything with it, so there was no way to even
-- detect that a prior attempt had already gone through.
--
-- This replaces all of that with one atomic function: any failure anywhere
-- in it (wallet_self_debit raising "Wallet not found", a department that
-- can't be resolved, anything) rolls back the whole thing -- the expense
-- row included. Doing this resolution in plain SQL also sidesteps the
-- bigint-vs-int4 PostgREST-serialization lookup bug class entirely: a
-- native SQL comparison between an int8 and an int4 column just works,
-- there's no JS String()/Number() involved at all.

ALTER TABLE public.requisitions
  ADD COLUMN IF NOT EXISTS converted_expense_id bigint REFERENCES public.expenses(id);

CREATE OR REPLACE FUNCTION public.fn_convert_expense_requisition_to_expense(p_req_id bigint)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_req public.requisitions%ROWTYPE;
  v_exp_id bigint;
  v_alloc jsonb;
  v_dept_name text;
  v_alloc_sum bigint := 0;
  v_remainder bigint;
  v_default_dept_id bigint;
  v_default_dept_name text;
  v_et_dept_id bigint;
  v_et_sub_dept_id bigint;
BEGIN
  SELECT * INTO v_req FROM public.requisitions WHERE id = p_req_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Requisition not found' USING ERRCODE = 'P0002';
  END IF;

  -- Idempotent: a requisition already converted (by this call or a prior one
  -- that got this far) just returns the same expense id instead of erroring
  -- or, worse, silently proceeding to create a second one.
  IF v_req.status = 'fulfilled' AND v_req.converted_expense_id IS NOT NULL THEN
    RETURN v_req.converted_expense_id;
  END IF;

  IF v_req.requested_by != auth.uid() THEN
    RAISE EXCEPTION 'Not your requisition' USING ERRCODE = '42501';
  END IF;
  IF v_req.req_type != 'expense' THEN
    RAISE EXCEPTION 'Not an expense requisition' USING ERRCODE = 'P0001';
  END IF;
  IF v_req.status != 'approved' THEN
    RAISE EXCEPTION 'Requisition is not approved' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.expenses (user_id, batch_id, expense_type_id, expense_sub_type_id, amount_paise, description, expense_date, status, receipt_path, event_id)
  VALUES (
    v_req.requested_by, gen_random_uuid(), v_req.expense_type_id, v_req.expense_sub_type_id, v_req.expense_amount_paise,
    COALESCE(v_req.purpose, 'From requisition #' || v_req.id), COALESCE(v_req.expense_date, current_date),
    'recorded', v_req.receipt_path, v_req.event_id
  )
  RETURNING id INTO v_exp_id;

  -- Copy whatever allocations the requisition's own form carried, resolving
  -- each row's real department name from department_id (never the
  -- requisition's own free-text `department` field, which doesn't
  -- necessarily match departments.name).
  FOR v_alloc IN SELECT * FROM jsonb_array_elements(COALESCE(v_req.expense_alloc_json, '[]'::jsonb))
  LOOP
    v_dept_name := NULL;
    IF v_alloc->>'department_id' IS NOT NULL THEN
      SELECT name INTO v_dept_name FROM public.departments WHERE id = (v_alloc->>'department_id')::bigint;
      IF v_dept_name IS NULL THEN
        RAISE EXCEPTION 'Department #% on this requisition''s allocation could not be found -- it may be inactive or deleted. Ask an admin to check Categories > Departments.', v_alloc->>'department_id' USING ERRCODE = 'P0001';
      END IF;
    END IF;

    INSERT INTO public.expense_allocations (expense_id, department, department_id, venue_id, amount_paise, expense_type_id, expense_sub_type_id, source)
    VALUES (
      v_exp_id, v_dept_name, (v_alloc->>'department_id')::bigint, (v_alloc->>'venue_id')::bigint,
      COALESCE((v_alloc->>'amount_paise')::bigint, 0),
      COALESCE((v_alloc->>'expense_type_id')::bigint, v_req.expense_type_id),
      COALESCE((v_alloc->>'expense_sub_type_id')::bigint, v_req.expense_sub_type_id),
      'allocation'
    );
    v_alloc_sum := v_alloc_sum + COALESCE((v_alloc->>'amount_paise')::bigint, 0);
  END LOOP;

  -- Auto-default the unallocated remainder from the requisition's own top-level
  -- type, same as ExpenseForm.jsx's own auto_default mechanism.
  v_remainder := COALESCE(v_req.expense_amount_paise, 0) - v_alloc_sum;
  IF v_remainder > 0 AND v_req.expense_type_id IS NOT NULL THEN
    SELECT department_id, sub_department_id INTO v_et_dept_id, v_et_sub_dept_id
    FROM public.expense_types WHERE id = v_req.expense_type_id;

    v_default_dept_id := v_et_dept_id;
    IF v_default_dept_id IS NULL AND v_et_sub_dept_id IS NOT NULL THEN
      SELECT department_id INTO v_default_dept_id FROM public.sub_departments WHERE id = v_et_sub_dept_id;
    END IF;

    IF v_default_dept_id IS NOT NULL THEN
      SELECT name INTO v_default_dept_name FROM public.departments WHERE id = v_default_dept_id;
      IF v_default_dept_name IS NULL THEN
        RAISE EXCEPTION 'Expense type''s department #% could not be found -- it may be inactive or deleted. Ask an admin to check Categories > Departments.', v_default_dept_id USING ERRCODE = 'P0001';
      END IF;
    END IF;

    INSERT INTO public.expense_allocations (expense_id, department, department_id, venue_id, amount_paise, expense_type_id, expense_sub_type_id, source)
    VALUES (v_exp_id, v_default_dept_name, v_default_dept_id, NULL, v_remainder, v_req.expense_type_id, v_req.expense_sub_type_id, 'auto_default');
  END IF;

  PERFORM public.wallet_self_debit(
    v_req.expense_amount_paise,
    'Expense: ' || left(COALESCE(v_req.purpose, ''), 50),
    'expense',
    v_exp_id::text
  );

  UPDATE public.requisitions SET status = 'fulfilled', converted_expense_id = v_exp_id WHERE id = p_req_id;

  RETURN v_exp_id;
END;
$function$;

NOTIFY pgrst, 'reload schema';
