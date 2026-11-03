-- Same bigint-vs-int4 department_id lookup bug as 00170/00171/00172 (same
-- user, same type/sub-dept: 55/23). This one landed after the ExpenseForm.jsx
-- fix was already deployed -- the submitting client was still running a
-- stale cached PWA bundle from before the fix, not a new instance of the bug.
-- Amount confirmed correct (large but genuine backdated entry).

INSERT INTO public.expense_allocations
  (expense_id, department, department_id, venue_id, expense_type_id, expense_sub_type_id, amount_paise, remarks, source)
SELECT 2788, 'Department', 23, NULL, 55, 337, 37200000, NULL, 'auto_default'
WHERE NOT EXISTS (SELECT 1 FROM public.expense_allocations WHERE expense_id = 2788);

DO $$
DECLARE
  v_user_id uuid := 'db68696f-3674-45ee-9cbe-680afd3baaba';
  v_wallet public.wallets%ROWTYPE;
BEGIN
  IF EXISTS (SELECT 1 FROM public.wallet_transactions WHERE reference_type = 'expense' AND reference_id = '2788') THEN
    RETURN;
  END IF;

  SELECT * INTO v_wallet FROM public.wallets WHERE user_id = v_user_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Wallet not found for user %', v_user_id;
  END IF;

  UPDATE public.wallets SET balance_paise = balance_paise - 37200000 WHERE id = v_wallet.id;

  INSERT INTO public.wallet_transactions
    (wallet_id, type, amount_paise, balance_after_paise, description, reference_type, reference_id, performed_by, status)
  VALUES
    (v_wallet.id, 'debit', 37200000, v_wallet.balance_paise - 37200000,
     'Expense: Back date ki slip -- 26/10/2026 Day out colour ki slip', 'expense', '2788', v_user_id, 'completed');
END $$;
