-- Same bug, same user/type as 00170-00173 (55/23). Confirmed still a stale
-- cached client (mobile PWA), not a new server-side occurrence.

INSERT INTO public.expense_allocations
  (expense_id, department, department_id, venue_id, expense_type_id, expense_sub_type_id, amount_paise, remarks, source)
SELECT 2789, 'Department', 23, NULL, 55, 529, 350000, NULL, 'auto_default'
WHERE NOT EXISTS (SELECT 1 FROM public.expense_allocations WHERE expense_id = 2789);

DO $$
DECLARE
  v_user_id uuid := 'db68696f-3674-45ee-9cbe-680afd3baaba';
  v_wallet public.wallets%ROWTYPE;
BEGIN
  IF EXISTS (SELECT 1 FROM public.wallet_transactions WHERE reference_type = 'expense' AND reference_id = '2789') THEN
    RETURN;
  END IF;

  SELECT * INTO v_wallet FROM public.wallets WHERE user_id = v_user_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Wallet not found for user %', v_user_id;
  END IF;

  UPDATE public.wallets SET balance_paise = balance_paise - 350000 WHERE id = v_wallet.id;

  INSERT INTO public.wallet_transactions
    (wallet_id, type, amount_paise, balance_after_paise, description, reference_type, reference_id, performed_by, status)
  VALUES
    (v_wallet.id, 'debit', 350000, v_wallet.balance_paise - 350000,
     'Expense: Manakla casual labour', 'expense', '2789', v_user_id, 'completed');
END $$;
