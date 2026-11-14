-- Deleting an expense refunded nothing once any earlier credit for it existed.
--
-- fn_refund_expense_debit (00165) skipped the refund when ANY 'expense_refund'
-- credit was already on the expense. But Send back (flag), Deduct and an edit
-- that lowers the amount all write that same reference type for their own,
-- partial credits. So:
--   flag -> resubmit -> delete     : the ₹ re-debited on resubmit never came back
--   deduct -> delete               : the allowed part never came back
--   edit down -> delete            : the new amount never came back
--
-- Now the refund is whatever is still out of the wallet for this expense:
-- every completed 'expense' debit minus every completed 'expense_refund'
-- credit. That also covers the cases the old check was there for (a flagged
-- expense, already refunded in full, nets to 0, and a second call nets to 0),
-- and it works on old rows as they are -- no data change needed.
CREATE OR REPLACE FUNCTION fn_refund_expense_debit(p_expense_id bigint, p_description text)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_exp expenses%ROWTYPE;
  v_wallet wallets%ROWTYPE;
  v_debited bigint;
  v_credited bigint;
  v_refund bigint;
BEGIN
  SELECT * INTO v_exp FROM expenses WHERE id = p_expense_id;
  IF NOT FOUND OR v_exp.deleted_at IS NULL THEN RETURN false; END IF;

  SELECT * INTO v_wallet FROM wallets WHERE user_id = v_exp.user_id FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;

  SELECT COALESCE(SUM(amount_paise), 0) INTO v_debited
  FROM wallet_transactions
  WHERE wallet_id = v_wallet.id AND type = 'debit'
    AND reference_type = 'expense' AND reference_id = p_expense_id::text
    AND COALESCE(status, 'completed') = 'completed';

  SELECT COALESCE(SUM(amount_paise), 0) INTO v_credited
  FROM wallet_transactions
  WHERE wallet_id = v_wallet.id AND type = 'credit'
    AND reference_type = 'expense_refund' AND reference_id = p_expense_id::text
    AND COALESCE(status, 'completed') = 'completed';

  v_refund := v_debited - v_credited;
  IF v_refund <= 0 THEN RETURN false; END IF;

  UPDATE wallets SET balance_paise = balance_paise + v_refund, updated_at = now()
  WHERE id = v_wallet.id;

  INSERT INTO wallet_transactions
    (wallet_id, type, amount_paise, balance_after_paise, description,
     reference_type, reference_id, performed_by, status)
  VALUES
    (v_wallet.id, 'credit', v_refund, v_wallet.balance_paise + v_refund,
     COALESCE(p_description, 'Refund: deleted expense'), 'expense_refund',
     p_expense_id::text, auth.uid(), 'completed');
  RETURN true;
END;
$$;

NOTIFY pgrst, 'reload schema';
