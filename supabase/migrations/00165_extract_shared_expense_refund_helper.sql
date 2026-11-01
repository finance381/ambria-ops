-- Why 00086 regressed a bug 00059 had already fixed, and how this stops it
-- happening a third time:
--
-- The "refund a deleted expense's wallet debit" rule has been written out
-- from scratch three separate times now, each time as a self-contained
-- block of logic rather than a call to shared code:
--   1. refund_wallet_on_delete (00056) -- a BEFORE DELETE trigger.
--   2. 00059 fixed that trigger's status check (only 'approved' refunded,
--      even though approved expenses keep moving through recorded/flagged/
--      acknowledged/deducted afterward) and added the payment_cash_paise
--      fallback for a credit-split expense.
--   3. 00086 discovered the trigger never actually fires (deletes are a
--      soft UPDATE, not a hard DELETE) and wrote a brand new RPC to replace
--      it. Its own header comment cites 00056/00059 by number -- so the
--      author knew they existed -- but the new RPC's guard (`status =
--      'recorded'`) was typed fresh rather than copied from the trigger's
--      THEN-CURRENT (post-00059) definition, so it silently reintroduced
--      the exact bug 00059 had already closed, plus dropped the
--      payment_cash_paise fallback on top. Citing a prior fix is not the
--      same as reusing its code -- that gap is what let the regression
--      through. 00164 re-fixed both.
--
-- The actual prevention: there is now exactly one function that knows how
-- to refund an expense's wallet debit, fn_refund_expense_debit. Any future
-- code path that needs to do this -- a delete, a different kind of
-- cancellation, whatever comes next -- calls it instead of writing the
-- debit-exists / already-refunded / payment_cash_paise-first logic out
-- again. There is nothing left to retype, so there is nothing left to
-- retype wrong.
--
-- It is deliberately gated on deleted_at IS NOT NULL rather than exposed
-- as a free-standing "refund any expense" primitive: every other
-- SECURITY DEFINER function in this codebase does its own auth check
-- rather than relying on a REVOKE EXECUTE (there is no precedent for that
-- pattern here), and this function has no caller-identity check of its
-- own. Requiring the expense to already be soft-deleted means the only way
-- to reach it is through fn_delete_expense_and_refund's own permission
-- check (submitter while recorded/flagged, or admin/finance-approver) --
-- a direct supabase.rpc('fn_refund_expense_debit', ...) call against a
-- still-live expense is a no-op, and the already-refunded check blocks
-- calling it twice against the same one.
CREATE OR REPLACE FUNCTION fn_refund_expense_debit(p_expense_id bigint, p_description text)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_exp expenses%ROWTYPE;
  v_wallet wallets%ROWTYPE;
  v_debit_exists boolean;
  v_already_refunded boolean;
  v_refund bigint;
BEGIN
  SELECT * INTO v_exp FROM expenses WHERE id = p_expense_id;
  IF NOT FOUND OR v_exp.deleted_at IS NULL THEN RETURN false; END IF;

  -- v87+: wallet was debited by cash portion only (see ExpenseForm.jsx:
  -- "Wallet debit = payment_cash_paise") -- a credit-split expense never
  -- had its full amount_paise taken out of the wallet to begin with.
  v_refund := COALESCE(v_exp.payment_cash_paise, v_exp.amount_paise, 0);
  IF v_refund <= 0 THEN RETURN false; END IF;

  SELECT * INTO v_wallet FROM wallets WHERE user_id = v_exp.user_id FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;

  SELECT EXISTS (
    SELECT 1 FROM wallet_transactions
    WHERE wallet_id = v_wallet.id AND type = 'debit'
      AND reference_type = 'expense' AND reference_id = p_expense_id::text
  ) INTO v_debit_exists;
  IF NOT v_debit_exists THEN RETURN false; END IF;

  SELECT EXISTS (
    SELECT 1 FROM wallet_transactions
    WHERE wallet_id = v_wallet.id AND type = 'credit'
      AND reference_type = 'expense_refund' AND reference_id = p_expense_id::text
  ) INTO v_already_refunded;
  IF v_already_refunded THEN RETURN false; END IF;

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

-- fn_delete_expense_and_refund now just orchestrates (auth check, soft
-- delete, then "was there a debit to refund") instead of also carrying the
-- refund mechanics inline -- identical behavior to 00164, rewritten to call
-- the shared helper above.
CREATE OR REPLACE FUNCTION fn_delete_expense_and_refund(p_expense_id bigint, p_delete_reason text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_exp expenses%ROWTYPE;
  v_uid uuid := auth.uid();
  v_is_admin boolean;
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

  PERFORM fn_refund_expense_debit(p_expense_id, 'Refund: deleted expense');
END;
$$;

NOTIFY pgrst, 'reload schema';
