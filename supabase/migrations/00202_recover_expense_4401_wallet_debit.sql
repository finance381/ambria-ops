-- Expense #4401 (Raj Singh, Cafe Janakpuri, "Glass wear, sweet corn 1kg",
-- 350000 paise... amount_paise 350300, fully cash: payment_cash_paise=350300,
-- payment_credit_paise=0) never got a wallet_transactions row -- same
-- orphaned-expense failure mode as #2785/#413/#463/#1159/#2158/#2356
-- (migrations 00170/00172): the expenses row inserted fine but the
-- expense_allocations insert that follows it in the same submit request
-- threw, which (by design, see ExpenseForm.jsx's catch block) skips the
-- wallet_self_debit call entirely and deletes any partial allocation.
--
-- Confirmed live: expense_allocations for #4401 (id 6921) is dated
-- 2026-11-21 17:46:27, a full day after the expense itself (2026-11-20
-- 13:59:49) -- and its receipt path is
-- "..._4401_edit_1795283187108_0.jpg", the literal naming pattern only the
-- EDIT branch uses (ExpenseForm.jsx:2011). So the allocation was restored
-- by a later edit, not the original submission -- but the edit branch only
-- debits the wallet for the DIFFERENCE between old/new amounts (walletDiff),
-- and the amount never changed, so walletDiff was 0 and no debit was ever
-- posted, even though the original one never happened either.
--
-- wallet_self_debit() can't be called here (keys off auth.uid()), so this
-- replicates its body directly against Raj Singh's own wallet.
DO $$
DECLARE
  v_user_id uuid := '39c1c329-d9e6-4105-88b4-9799e489e2da';
  v_wallet public.wallets%ROWTYPE;
BEGIN
  IF EXISTS (SELECT 1 FROM public.wallet_transactions WHERE reference_type = 'expense' AND reference_id = '4401') THEN
    RETURN;
  END IF;

  SELECT * INTO v_wallet FROM public.wallets WHERE user_id = v_user_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Wallet not found for user %', v_user_id;
  END IF;

  UPDATE public.wallets SET balance_paise = balance_paise - 350300 WHERE id = v_wallet.id;

  INSERT INTO public.wallet_transactions
    (wallet_id, type, amount_paise, balance_after_paise, description, reference_type, reference_id, performed_by, status)
  VALUES
    (v_wallet.id, 'debit', 350300, v_wallet.balance_paise - 350300,
     'Expense: Glass wear, sweet corn 1kg', 'expense', '4401', v_user_id, 'completed');
END $$;
