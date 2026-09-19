-- The "checked" stamp lived only on wallet_transactions, which is a
-- personal-wallet-perspective row — but not every expense debits a wallet
-- (a fully vendor-credit-funded purchase never does), and an expense is
-- shown from several different angles (Wallet row, Expenses list, Expense
-- Ledger, Event Ledger, the expense detail modal opened from any of them,
-- Vendor Ledger's purchase-linked entries) that don't all share one
-- wallet_transactions row. Moving it onto expenses itself — the one row
-- every one of those screens is ultimately displaying — makes "checked"
-- consistent everywhere instead of being tied to whichever ledger happened
-- to render it first.

ALTER TABLE expenses
  ADD COLUMN IF NOT EXISTS checked_by uuid REFERENCES profiles(id),
  ADD COLUMN IF NOT EXISTS checked_at timestamptz;

CREATE OR REPLACE FUNCTION fn_toggle_expense_check(p_expense_id bigint)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_checked_by uuid;
  v_role text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'auth required' USING errcode = '28000';
  END IF;
  IF NOT user_can('finance.wallet.mark_checked') THEN
    RAISE EXCEPTION 'permission denied' USING errcode = '42501';
  END IF;

  SELECT checked_by INTO v_checked_by
  FROM expenses WHERE id = p_expense_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'expense not found';
  END IF;

  IF v_checked_by IS NULL THEN
    UPDATE expenses SET checked_by = v_uid, checked_at = now()
    WHERE id = p_expense_id;
    RETURN true;
  END IF;

  v_role := user_role();
  IF v_checked_by <> v_uid AND v_role NOT IN ('admin', 'auditor') THEN
    RAISE EXCEPTION 'only the person who checked this entry can un-check it';
  END IF;

  UPDATE expenses SET checked_by = NULL, checked_at = NULL
  WHERE id = p_expense_id;
  RETURN false;
END;
$$;

NOTIFY pgrst, 'reload schema';
