-- Jai Singh's #3597/#3599/#3600 (recovered in 00203) are a live instance of
-- a gap flagged earlier and left unfixed: ExpenseForm.jsx's edit branch
-- computes walletDiff = newWalletSpend - oldWalletSpend, where oldWalletSpend
-- comes from the expense row's OWN payment_cash_paise/amount_paise field --
-- an assumption that a debit for that amount actually landed in the wallet.
-- When the original submit's wallet_self_debit silently failed (the #4401
-- orphaned-expense pattern), editing the amount down still "refunded" the
-- difference against a debit that was never really there.
--
-- fn_refund_expense_debit (00194) already closed the equivalent gap on the
-- delete/flag path by netting real wallet_transactions rows instead of
-- trusting a stored field. This gives the edit path the same real number to
-- diff against: every completed 'expense' debit for this expense, minus
-- every completed 'expense_refund'/'expense_refund_correction' credit
-- already posted against it -- so an amount that was never actually debited
-- nets to 0, and no further edit can credit it away a second time.
CREATE OR REPLACE FUNCTION fn_expense_wallet_debited_net(p_expense_id bigint)
RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_net bigint;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'auth required' USING errcode = '28000';
  END IF;

  SELECT COALESCE(SUM(
    CASE
      WHEN wt.type = 'debit' AND wt.reference_type = 'expense' THEN wt.amount_paise
      WHEN wt.type = 'credit' AND wt.reference_type IN ('expense_refund', 'expense_refund_correction') THEN -wt.amount_paise
      ELSE 0
    END
  ), 0) INTO v_net
  FROM public.wallet_transactions wt
  WHERE wt.reference_id = p_expense_id::text
    AND wt.reference_type IN ('expense', 'expense_refund', 'expense_refund_correction')
    AND COALESCE(wt.status, 'completed') = 'completed';

  RETURN v_net;
END;
$$;

NOTIFY pgrst, 'reload schema';
