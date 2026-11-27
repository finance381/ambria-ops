-- Other Income can now be tagged to a Department + Expense Type, posted as a
-- credit against that expense type's own ledger -- the same existing
-- mechanism a vendor-deduction credit already uses (cost_transfers,
-- to_party_type='expense'), which Ledgers.jsx already aggregates per
-- department/expense type as a credit reducing net spend. Required for bank
-- collections (that's the real use case: bank income landing against a
-- department's books), optional for cash.
--
-- cost_transfers models a transfer BETWEEN two tracked internal parties
-- (vendor/employee/event/expense) -- there's no existing party type for
-- "money from outside the system" the way Other Income actually is.
-- from_party_type has no CHECK constraint restricting its values (only
-- fn_create_cost_transfer's own IS NULL check), and _post_cost_transfer_
-- ledgers already has no branch for 'expense' (Ledgers.jsx reads those rows
-- directly) -- adding 'external' as a new from_party_type works the same
-- way today with zero schema change: it simply falls through every existing
-- IF/ELSIF with no ledger_entries row posted on that side, exactly like
-- 'expense' already does. This writes a real cost_transfers row (not
-- through fn_create_cost_transfer's own RPC, which is gated on
-- user_can('finance.cost_transfers') -- Other Income stays open to any
-- staff member with a wallet, same as event collections).
ALTER TABLE public.other_income_entries
  ADD COLUMN department_id bigint REFERENCES public.departments(id),
  ADD COLUMN expense_type_id integer REFERENCES public.expense_types(id),
  ADD COLUMN cost_transfer_id bigint REFERENCES public.cost_transfers(id);

DROP FUNCTION IF EXISTS public.fn_wallet_collect_other_income(bigint, text, bigint, text, text, text, date);

CREATE OR REPLACE FUNCTION public.fn_wallet_collect_other_income(
  p_income_type_id bigint,
  p_payment_mode text,
  p_amount_paise bigint,
  p_description text,
  p_receipt_path text,
  p_bank_payment_type text DEFAULT NULL,
  p_entry_date date DEFAULT NULL,
  p_department_id bigint DEFAULT NULL,
  p_expense_type_id integer DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_wallet public.wallets%ROWTYPE;
  v_new_bal bigint;
  v_tx_id uuid;
  v_entry_id bigint;
  v_receipt_no text;
  v_resolved_dept_id bigint;
  v_transfer_id bigint;
BEGIN
  IF p_payment_mode NOT IN ('cash', 'bank') THEN RAISE EXCEPTION 'invalid payment_mode'; END IF;
  IF p_amount_paise IS NULL OR p_amount_paise <= 0 THEN RAISE EXCEPTION 'amount must be positive'; END IF;
  IF p_receipt_path IS NULL OR length(trim(p_receipt_path)) = 0 THEN
    RAISE EXCEPTION 'receipt photo is required';
  END IF;
  IF p_payment_mode = 'bank' AND (p_bank_payment_type IS NULL OR length(trim(p_bank_payment_type)) = 0) THEN
    RAISE EXCEPTION 'payment type required for bank collections';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.income_types WHERE id = p_income_type_id AND active) THEN
    RAISE EXCEPTION 'income type not found or inactive';
  END IF;

  IF (p_department_id IS NULL) <> (p_expense_type_id IS NULL) THEN
    RAISE EXCEPTION 'department and expense type must be provided together';
  END IF;
  IF p_payment_mode = 'bank' AND p_department_id IS NULL THEN
    RAISE EXCEPTION 'department and expense type are required for bank collections';
  END IF;
  IF p_department_id IS NOT NULL THEN
    SELECT COALESCE(et.department_id, sd.department_id) INTO v_resolved_dept_id
    FROM public.expense_types et
    LEFT JOIN public.sub_departments sd ON sd.id = et.sub_department_id
    WHERE et.id = p_expense_type_id AND et.active;
    IF v_resolved_dept_id IS NULL OR v_resolved_dept_id <> p_department_id THEN
      RAISE EXCEPTION 'expense type does not belong to the selected department';
    END IF;
  END IF;

  SELECT * INTO v_wallet FROM public.wallets WHERE user_id = auth.uid() FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'wallet not found'; END IF;

  -- Only cash physically sits with the collector — only cash moves the
  -- wallet (same rule as fn_wallet_collect).
  IF p_payment_mode = 'cash' THEN
    v_new_bal := v_wallet.balance_paise + p_amount_paise;
  ELSE
    v_new_bal := v_wallet.balance_paise;
  END IF;
  UPDATE public.wallets SET balance_paise = v_new_bal WHERE id = v_wallet.id;

  -- Own mode letter ('O') rather than reusing event collections' C/B so
  -- Other Income receipts are their own recognizable series.
  v_receipt_no := fn_next_receipt_no(fn_indian_fy_code(COALESCE(p_entry_date, current_date)), 'O');

  INSERT INTO public.other_income_entries
    (income_type_id, amount_paise, payment_mode, bank_payment_type, description, entry_date, receipt_path, receipt_no, collected_by, department_id, expense_type_id)
  VALUES
    (p_income_type_id, p_amount_paise, p_payment_mode, p_bank_payment_type, p_description, COALESCE(p_entry_date, current_date), p_receipt_path, v_receipt_no, auth.uid(), p_department_id, p_expense_type_id)
  RETURNING id INTO v_entry_id;

  INSERT INTO public.wallet_transactions
    (wallet_id, type, amount_paise, balance_after_paise, description, reference_type, reference_id, performed_by, status, payment_mode, bank_payment_type, received_image_path, received_at, receipt_no, collection_date)
  VALUES
    (v_wallet.id, 'credit', p_amount_paise, v_new_bal, p_description, 'other_income', v_entry_id::text, auth.uid(), 'completed', p_payment_mode, p_bank_payment_type, p_receipt_path, now(), v_receipt_no, COALESCE(p_entry_date, current_date))
  RETURNING id INTO v_tx_id;

  IF p_department_id IS NOT NULL THEN
    INSERT INTO public.cost_transfers
      (amount_paise, from_party_type, to_party_type, to_expense_type_id, description, reason_note, effective_date, created_by, metadata, receipt_path)
    VALUES
      (p_amount_paise, 'external', 'expense', p_expense_type_id,
       'Other income: ' || p_description, 'Wallet > Collect > Other Income', COALESCE(p_entry_date, current_date), auth.uid(),
       jsonb_build_object('source', 'other_income', 'other_income_entry_id', v_entry_id), p_receipt_path)
    RETURNING id INTO v_transfer_id;

    PERFORM public._post_cost_transfer_ledgers(v_transfer_id);
  END IF;

  UPDATE public.other_income_entries SET wallet_tx_id = v_tx_id, cost_transfer_id = v_transfer_id WHERE id = v_entry_id;

  RETURN json_build_object(
    'wallet_tx_id', v_tx_id,
    'entry_id', v_entry_id,
    'receipt_no', v_receipt_no,
    'new_balance_paise', v_new_bal,
    'cost_transfer_id', v_transfer_id
  );
END;
$function$;

NOTIFY pgrst, 'reload schema';
