-- fn_delete_expense_and_refund (00086) only refunded `IF v_exp.status =
-- 'recorded'` -- but a 'recorded' expense keeps moving through a
-- post-approval bookkeeping track for AE/AEE-style categories (recorded ->
-- flagged/acknowledged -> deducted), exactly the same shape of bug the
-- refund_wallet_on_delete trigger had before 00059 fixed it: once status
-- moves past 'recorded', the guard silently skipped the refund even though
-- the wallet debit was still sitting there untouched. Reported: Harsh
-- Sharma's acknowledged "Light and sound..." expense (#2567, 60,000 pts)
-- was deleted and never refunded.
--
-- 00086 also narrowed the refund amount to `v_exp.amount_paise` outright,
-- dropping the payment_cash_paise fallback 00056/00059 already established
-- for a credit-split expense (ExpenseForm.jsx: "Wallet debit =
-- payment_cash_paise", v87+) -- refunding the full gross amount would
-- over-credit the wallet by whatever portion was paid on credit, not cash.
--
-- Fix, matching 00059's already-proven rule: refund whenever a debit for
-- this expense actually exists AND it hasn't already been refunded once
-- (an expense flagged while 'recorded' is refunded inline by
-- ExpenseDetail.jsx's flag() already -- that debit row survives, so without
-- this check a later delete would refund it a second time), crediting
-- COALESCE(payment_cash_paise, amount_paise) rather than the gross amount.
CREATE OR REPLACE FUNCTION fn_delete_expense_and_refund(p_expense_id bigint, p_delete_reason text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_exp expenses%ROWTYPE;
  v_uid uuid := auth.uid();
  v_is_admin boolean;
  v_wallet wallets%ROWTYPE;
  v_debit_exists boolean;
  v_already_refunded boolean;
  v_refund bigint;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'auth required' USING errcode = '28000';
  END IF;

  SELECT * INTO v_exp FROM expenses WHERE id = p_expense_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'expense_not_found'; END IF;
  IF v_exp.deleted_at IS NOT NULL THEN RAISE EXCEPTION 'already_deleted'; END IF;

  -- Mirrors ExpenseDetail.jsx's canDelete exactly: the submitter themselves
  -- (only while recorded/flagged), or an admin/finance-approver, any status.
  v_is_admin := user_role() = 'admin' OR user_can('finance.expenses.approve');
  IF NOT (v_is_admin OR (v_exp.user_id = v_uid AND v_exp.status IN ('recorded', 'flagged'))) THEN
    RAISE EXCEPTION 'permission_denied';
  END IF;

  UPDATE expenses
  SET deleted_at = now(), deleted_by = v_uid, delete_reason = p_delete_reason
  WHERE id = p_expense_id;

  v_refund := COALESCE(v_exp.payment_cash_paise, v_exp.amount_paise, 0);
  IF v_refund > 0 THEN
    SELECT * INTO v_wallet FROM wallets WHERE user_id = v_exp.user_id FOR UPDATE;
    IF FOUND THEN
      SELECT EXISTS (
        SELECT 1 FROM wallet_transactions
        WHERE wallet_id = v_wallet.id AND type = 'debit'
          AND reference_type = 'expense' AND reference_id = p_expense_id::text
      ) INTO v_debit_exists;

      SELECT EXISTS (
        SELECT 1 FROM wallet_transactions
        WHERE wallet_id = v_wallet.id AND type = 'credit'
          AND reference_type = 'expense_refund' AND reference_id = p_expense_id::text
      ) INTO v_already_refunded;

      IF v_debit_exists AND NOT v_already_refunded THEN
        UPDATE wallets SET balance_paise = balance_paise + v_refund, updated_at = now()
        WHERE id = v_wallet.id;

        INSERT INTO wallet_transactions
          (wallet_id, type, amount_paise, balance_after_paise, description,
           reference_type, reference_id, performed_by, status)
        VALUES
          (v_wallet.id, 'credit', v_refund, v_wallet.balance_paise + v_refund,
           'Refund: deleted expense', 'expense_refund', p_expense_id::text, v_uid, 'completed');
      END IF;
    END IF;
  END IF;
END;
$$;

-- ── One-time backfill: Harsh Sharma's #2567, and anyone else this already
-- shorted since 00086 shipped -- every deleted, non-refunded expense with a
-- surviving debit row. ──
DO $$
DECLARE
  r RECORD;
  v_wallet wallets%ROWTYPE;
  v_refund bigint;
  v_already_refunded boolean;
BEGIN
  FOR r IN
    SELECT e.id, e.user_id, e.payment_cash_paise, e.amount_paise, e.description
    FROM expenses e
    WHERE e.deleted_at IS NOT NULL
  LOOP
    v_refund := COALESCE(r.payment_cash_paise, r.amount_paise, 0);
    IF v_refund <= 0 THEN CONTINUE; END IF;

    SELECT * INTO v_wallet FROM wallets WHERE user_id = r.user_id;
    IF NOT FOUND THEN CONTINUE; END IF;

    IF NOT EXISTS (
      SELECT 1 FROM wallet_transactions
      WHERE wallet_id = v_wallet.id AND type = 'debit'
        AND reference_type = 'expense' AND reference_id = r.id::text
    ) THEN CONTINUE; END IF;

    SELECT EXISTS (
      SELECT 1 FROM wallet_transactions
      WHERE wallet_id = v_wallet.id AND type = 'credit'
        AND reference_type = 'expense_refund' AND reference_id = r.id::text
    ) INTO v_already_refunded;
    IF v_already_refunded THEN CONTINUE; END IF;

    UPDATE wallets SET balance_paise = balance_paise + v_refund, updated_at = now()
     WHERE id = v_wallet.id
    RETURNING * INTO v_wallet;

    INSERT INTO wallet_transactions
      (wallet_id, type, amount_paise, balance_after_paise, description,
       reference_type, reference_id, performed_by, status)
    VALUES
      (v_wallet.id, 'credit', v_refund, v_wallet.balance_paise,
       'Refund (backfill): deleted expense #' || r.id, 'expense_refund',
       r.id::TEXT, NULL, 'completed');

    RAISE NOTICE 'Refunded % paise to wallet % for deleted expense #%', v_refund, v_wallet.id, r.id;
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
