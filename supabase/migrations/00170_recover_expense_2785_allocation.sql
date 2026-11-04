-- Recovery for the bigint-vs-int4 department_id lookup bug fixed in
-- ExpenseForm.jsx this same session: expense #2785 (Pushpanjali casual
-- labour bill, type 55 "AEE Expenses (Entertainment)" / sub-type 529,
-- amount 420000 paise) got its main row inserted but its auto-default
-- allocation insert failed on expense_allocations.department's NOT NULL
-- constraint, leaving it with no allocation and no wallet debit.
--
-- department_id 23's real name, as confirmed live: "Department".

INSERT INTO public.expense_allocations
  (expense_id, department, department_id, venue_id, expense_type_id, expense_sub_type_id, amount_paise, remarks, source)
SELECT 2785, 'Department', 23, NULL, 55, 529, 420000, NULL, 'auto_default'
WHERE NOT EXISTS (SELECT 1 FROM public.expense_allocations WHERE expense_id = 2785);

-- The wallet debit never ran either (same failed submission, same try block
-- -- it comes after the allocation insert that threw). wallet_self_debit()
-- can't be called here since it keys off auth.uid(), which has no value
-- outside a real authenticated request -- this replicates its body exactly,
-- targeting expense #2785's actual owner (db68696f-3674-45ee-9cbe-680afd3baaba)
-- explicitly instead.
DO $$
DECLARE
  v_user_id uuid := 'db68696f-3674-45ee-9cbe-680afd3baaba';
  v_wallet public.wallets%ROWTYPE;
BEGIN
  IF EXISTS (SELECT 1 FROM public.wallet_transactions WHERE reference_type = 'expense' AND reference_id = '2785') THEN
    RETURN;
  END IF;

  SELECT * INTO v_wallet FROM public.wallets WHERE user_id = v_user_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Wallet not found for user %', v_user_id;
  END IF;

  UPDATE public.wallets SET balance_paise = balance_paise - 420000 WHERE id = v_wallet.id;

  INSERT INTO public.wallet_transactions
    (wallet_id, type, amount_paise, balance_after_paise, description, reference_type, reference_id, performed_by, status)
  VALUES
    (v_wallet.id, 'debit', 420000, v_wallet.balance_paise - 420000,
     'Expense: Pushpanjali casual labour bill', 'expense', '2785', v_user_id, 'completed');
END $$;
