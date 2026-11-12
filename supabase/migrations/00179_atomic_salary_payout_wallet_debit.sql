-- fn_record_salary_payout (00097) deliberately left the wallet debit as a
-- separate client-side wallet_self_debit call, citing ExpenseForm.jsx's own
-- cash-expense pattern as precedent. This regression pass found that exact
-- pattern is the actual bug class: if the debit fails after the payout RPC
-- already committed, the client's own error path doesn't reset the form, so
-- clicking Save again records a genuine second payout batch (fn_record_
-- salary_payout has no way to know the first one's debit failed).
--
-- Folds wallet_self_debit into this same function instead -- a failed debit
-- now rolls back the whole payout, so there's never a committed batch with
-- no matching debit to retry into a duplicate.

CREATE OR REPLACE FUNCTION public.fn_record_salary_payout(p_date date, p_entries jsonb)
RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_batch_id bigint;
  v_entry jsonb;
  v_emp_id uuid;
  v_cash bigint;
  v_bank bigint;
  v_total_cash bigint := 0;
  v_total_bank bigint := 0;
  v_entry_count int := 0;
BEGIN
  IF NOT public._salary_payout_caller_ok() THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  IF p_date IS NULL THEN
    RAISE EXCEPTION 'Payment date is required';
  END IF;
  IF p_date > current_date THEN
    RAISE EXCEPTION 'Payment date cannot be in the future';
  END IF;
  IF jsonb_typeof(p_entries) <> 'array' OR jsonb_array_length(p_entries) = 0 THEN
    RAISE EXCEPTION 'Add at least one employee';
  END IF;

  INSERT INTO public.salary_payout_batches (payout_date, created_by)
  VALUES (p_date, auth.uid())
  RETURNING id INTO v_batch_id;

  FOR v_entry IN SELECT * FROM jsonb_array_elements(p_entries) LOOP
    v_emp_id := nullif(v_entry->>'employee_id', '')::uuid;
    v_cash   := coalesce((v_entry->>'cash_paise')::bigint, 0);
    v_bank   := coalesce((v_entry->>'bank_paise')::bigint, 0);

    IF v_emp_id IS NULL THEN
      RAISE EXCEPTION 'Every row needs an employee';
    END IF;
    IF v_cash < 0 OR v_bank < 0 THEN
      RAISE EXCEPTION 'Amounts cannot be negative';
    END IF;
    IF v_cash = 0 AND v_bank = 0 THEN
      CONTINUE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.employees WHERE id = v_emp_id) THEN
      RAISE EXCEPTION 'Unknown employee';
    END IF;

    INSERT INTO public.salary_payout_entries (batch_id, employee_id, payout_date, cash_paise, bank_paise)
    VALUES (v_batch_id, v_emp_id, p_date, v_cash, v_bank);

    v_total_cash := v_total_cash + v_cash;
    v_total_bank := v_total_bank + v_bank;
    v_entry_count := v_entry_count + 1;
  END LOOP;

  IF v_total_cash = 0 AND v_total_bank = 0 THEN
    RAISE EXCEPTION 'Enter at least one cash or bank amount';
  END IF;

  UPDATE public.salary_payout_batches
  SET total_cash_paise = v_total_cash, total_bank_paise = v_total_bank
  WHERE id = v_batch_id;

  IF v_total_cash > 0 THEN
    PERFORM public.wallet_self_debit(
      v_total_cash,
      'Salary payout — ' || v_entry_count || ' employee(s)',
      'salary_payout',
      v_batch_id::text
    );
  END IF;

  RETURN v_batch_id;
END;
$$;

NOTIFY pgrst, 'reload schema';
